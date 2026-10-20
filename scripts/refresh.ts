#!/usr/bin/env tsx
/**
 * ExamLens refresh pipeline.
 *
 * 1. Pull the live TNPSC exam dashboard (2026 and 2025).
 * 2. Diff every exam's document list against the stored snapshot.
 * 3. Read each new addendum / press release and extract explicit date changes
 *    ("postponed from 06.09.2026 to 27.09.2026") with the source sentence.
 * 4. Re-verify every curated citation against the official PDF/HTML.
 * 5. Write snapshot, changelog, freshness and citation reports.
 *
 * No LLM calls, no paid APIs. Deterministic, idempotent, safe to run hourly.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TnpscClient, PUBLIC_DASHBOARD_URL, parseTitle, type TnpscExamDetail } from '../src/lib/ingest/sources/tnpsc';
import { fetchResource, mapLimit, NotModifiedError } from '../src/lib/ingest/http';
import { extractPdf } from '../src/lib/ingest/pdf';
import { verifyExamSources, type VerifyState } from '../src/lib/ingest/verify';
import { diffFeed, makeChangeEvent, parseOfficialDateChange, mentionsVacancyRevision, vacancyEvidence, addendumRef, toDatedDoc, hashId } from '../src/lib/core/changelog';
import { isoNow, formatDate } from '../src/lib/core/dates';
import { ExamSchema, type ChangeEvent, type Exam, type ExamFeed, type Freshness } from '../src/lib/core/types';
import { normalizeNotificationNo, trackedExamId } from '../src/lib/core/constants';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const STATE = join(DATA, 'state');
const CURATED = join(DATA, 'curated', 'exams');

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const OFFLINE = args.includes('--offline');
const NOW = isoNow();

interface Snapshot {
  version: number;
  updatedAt: string;
  exams: Record<string, ExamFeed>;
  parsedDocs: Record<string, { at: string; kind: string; quote?: string }>;
}

const emptySnapshot: Snapshot = { version: 1, updatedAt: NOW, exams: {}, parsedDocs: {} };

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch (err) {
    throw new Error(`Corrupt state file ${path}: ${(err as Error).message}. Delete it to rebuild from scratch.`);
  }
}

/** Write to a temporary file and rename, so a killed run cannot truncate state. */
function writeJson(path: string, value: unknown): void {
  if (DRY) return;
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
}

function loadCurated(): Exam[] {
  if (!existsSync(CURATED)) return [];
  const files = readdirSync(CURATED).filter((f) => f.endsWith('.json')).sort();
  const exams: Exam[] = [];
  for (const file of files) {
    const raw = JSON.parse(readFileSync(join(CURATED, file), 'utf8'));
    const parsed = ExamSchema.safeParse(raw);
    if (!parsed.success) {
      console.error(`✗ ${file}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
      process.exitCode = 1;
      continue;
    }
    exams.push(parsed.data);
  }
  return exams;
}

function log(step: string, msg: string) {
  console.log(`${step.padEnd(6)} ${msg}`);
}

async function main() {
  const snapshot = readJson<Snapshot>(join(STATE, 'snapshot.json'), emptySnapshot);
  // `--rebuild-log` regenerates the log from the sources instead of appending.
  if (args.includes('--rebuild-log')) {
    snapshot.parsedDocs = {};
  }
  const changelogFile = readJson<{ version: number; events: ChangeEvent[] }>(join(STATE, 'changelog.json'), {
    version: 1,
    events: [],
  });
  if (args.includes('--rebuild-log')) changelogFile.events = [];
  const verifyState = readJson<VerifyState>(join(STATE, 'verify.json'), {});
  const curated = loadCurated();

  const examsByNotif = new Map<string, Exam>();
  for (const e of curated) {
    const n = normalizeNotificationNo(e.notificationNo);
    if (!n) continue;
    // Notification numbers are only unique within a board: TNPSC and TRB both
    // issue a "01/2026".
    examsByNotif.set(`${e.board}:${n}`, e);
  }

  const events: ChangeEvent[] = [];

  /* ---------------------------------------------------------------- */
  /* 1. TNPSC live dashboard                                           */
  /* ---------------------------------------------------------------- */
  const sourceChecks: Freshness['sources'] = [];

  if (!OFFLINE) {
    const client = new TnpscClient();
    // Government dashboards can be slow from CI runners outside India; the
    // years to poll are configurable so a run can stay within its budget.
    const configured = (process.env.EXAM_LENS_YEARS ?? '2026,2025')
      .split(',')
      .map((y) => Number(y.trim()))
      .filter((y) => Number.isFinite(y));
    const years = new Set<number>([...configured, ...curated.filter((e) => e.board === 'tnpsc').map((e) => e.year)]);
    const yearList = [...years].sort((a, b) => b - a);

    for (const year of yearList) {
      let refs: Awaited<ReturnType<TnpscClient['listExams']>> = [];
      try {
        refs = await client.listExams(year);
        log('tnpsc', `${year}: ${refs.length} exams on dashboard`);
      } catch (err) {
        log('tnpsc', `${year}: FAILED ${(err as Error).message}`);
        sourceChecks.push({
          id: `tnpsc-dashboard-${year}`,
          name: `TNPSC exam dashboard ${year}`,
          url: PUBLIC_DASHBOARD_URL,
          checkedAt: NOW,
          httpStatus: null,
          ok: false,
          contentHash: null,
          changed: false,
          error: (err as Error).message,
          consecutiveFailures: 1,
        });
        continue;
      }

      sourceChecks.push({
        id: `tnpsc-dashboard-${year}`,
        name: `TNPSC exam dashboard ${year}`,
        url: PUBLIC_DASHBOARD_URL,
        checkedAt: NOW,
        httpStatus: 200,
        ok: refs.length > 0,
        contentHash: hashId(refs.map((r) => `${r.notid}:${r.title}`).join('|')),
        changed: false,
        error: refs.length ? null : 'no exams parsed',
        consecutiveFailures: 0,
      });

      const details = await mapLimit(refs, 5, async (ref) => {
        try {
          return await client.detail(ref.notid);
        } catch (err) {
          log('tnpsc', `detail failed ${ref.notificationNo}: ${(err as Error).message}`);
          return null;
        }
      });

      for (let i = 0; i < refs.length; i++) {
        const ref = refs[i];
        const detail = details[i] as TnpscExamDetail | null;
        if (!detail) continue;
        const meta = parseTitle(detail.title || ref.title);
        const notif = normalizeNotificationNo(meta.notificationNo ?? ref.notificationNo) ?? '';
        const key = `tnpsc:${notif}`;
        const exam = examsByNotif.get(key);

        const feed: ExamFeed = {
          examId: exam?.id ?? trackedExamId(notif) ?? `tnpsc-${ref.notid.slice(0, 8)}`,
          sourceExamId: ref.notid,
          title: detail.title || ref.title,
          docs: detail.docs.map((d) => toDatedDoc(d, NOW)).sort((a, b) => (b.uploadedAt ?? '').localeCompare(a.uploadedAt ?? '')),
          examDateRaw: detail.examDateRaw,
          applyRaw: detail.applyRaw,
          fetchedAt: NOW,
          sourceUrl: detail.pageUrl,
        };

        const prev = snapshot.exams[ref.notid] ?? null;
        const baseline = prev === null;
        // A dashboard that briefly renders empty must not look like every
        // document was withdrawn: restore the previous list before diffing.
        const looksEmpty = Boolean(prev && feed.docs.length === 0 && prev.docs.length > 0);
        if (looksEmpty && prev) {
          log('guard', `${notif}: dashboard returned no documents, keeping previous snapshot`);
          feed.docs = prev.docs;
          feed.examDateRaw = prev.examDateRaw;
          feed.applyRaw = prev.applyRaw;
        }
        const diffs = looksEmpty ? [] : diffFeed(prev, feed, baseline);

        for (const diff of diffs) {
          if (!exam && diff.kind !== 'new_notification') continue;
          events.push(
            makeChangeEvent({
              examId: feed.examId,
              examName: exam?.name ?? meta.name,
              diff,
              detectedAt: NOW,
              effectiveAt: diff.doc?.uploadedAt ?? null,
              sourceUrl: diff.doc?.url ?? detail.pageUrl,
              sourceTitle: diff.doc?.title ?? feed.title,
              confidence: 'official',
            }),
          );
        }
        snapshot.exams[ref.notid] = feed;

        /* 2. read small addendum PDFs for explicit date changes */
        const fresh = feed.docs.filter(
          (d) => d.url && /addendum|press/i.test(`${d.category} ${d.title}`) && !snapshot.parsedDocs[d.id],
        );
        for (const doc of fresh.slice(0, 6)) {
          try {
            const res = await fetchResource(doc.url!, { timeoutMs: 45_000, retries: 1 });
            if (!res.ok) continue;
            const pdf = await extractPdf(res.bytes);
            const change = parseOfficialDateChange(pdf.text);
            snapshot.parsedDocs[doc.id] = { at: NOW, kind: change ? 'date_change' : 'none', quote: change?.quote };
            if (change) {
              events.push(
                makeChangeEvent({
                  examId: feed.examId,
                  examName: exam?.name ?? meta.name,
                  diff: {
                    kind: 'exam_date_changed',
                    field: 'examDate',
                    before: change.before,
                    after: change.after,
                    summary: `Exam moved from ${formatDate(change.before)} to ${formatDate(change.after)}`,
                  },
                  detectedAt: NOW,
                  effectiveAt: doc.uploadedAt,
                  sourceUrl: doc.url!,
                  sourceTitle: doc.title,
                  evidence: change.quote,
                  confidence: 'official',
                }),
              );
            } else if (mentionsVacancyRevision(pdf.text)) {
              snapshot.parsedDocs[doc.id] = { at: NOW, kind: 'vacancy_revision' };
              events.push(
                makeChangeEvent({
                  examId: feed.examId,
                  examName: exam?.name ?? meta.name,
                  diff: {
                    kind: 'vacancies_revised',
                    field: 'vacancies',
                    before: null,
                    after: 'revised',
                    summary: `Vacancy count revised — ${addendumRef(doc.title) ?? 'addendum'}`,  
                  },
                  detectedAt: NOW,
                  effectiveAt: doc.uploadedAt,
                  sourceUrl: doc.url!,
                  sourceTitle: doc.title,
                  evidence: vacancyEvidence(pdf.text),
                  confidence: 'official',
                }),
              );
            }
          } catch (err) {
            log('pdf', `${notif}: ${(err as Error).message}`);
          }
        }
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* 3. Citation verification for every curated exam                   */
  /* ---------------------------------------------------------------- */
  const reports = [];
  for (const exam of curated) {
    const report = await verifyExamSources(exam, { state: verifyState, now: NOW, offline: OFFLINE });
    reports.push(report);
    const bad = report.issues.length;
    const changedSources = report.changedSources.length;
    log('verify', `${exam.id}: ${report.sources.filter((s) => s.ok).length}/${report.sources.length} sources ok, ${bad} quote issue(s)${changedSources ? `, ${changedSources} changed` : ''}`);
    for (const issue of report.issues) {
      log('  ⚠', `${issue.where}: ${issue.quote.slice(0, 70)}… (score ${issue.score.toFixed(2)})`);
    }
  }

  /* ---------------------------------------------------------------- */
  /* 4. Merge changelog (idempotent, newest first)                      */
  /* ---------------------------------------------------------------- */
  const seen = new Set<string>();
  const merged: ChangeEvent[] = [];
  for (const e of [...events, ...changelogFile.events]) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    merged.push(e);
  }
  merged.sort((a, b) => (b.effectiveAt ?? b.detectedAt).localeCompare(a.effectiveAt ?? a.detectedAt));
  const trimmed = merged.slice(0, 500);

  /* ---------------------------------------------------------------- */
  /* 5. Freshness                                                       */
  /* ---------------------------------------------------------------- */
  const reportByExam = new Map(reports.map((r) => [r.examId, r]));
  const freshness: Freshness = {
    generatedAt: NOW,
    sources: sourceChecks,
    exams: curated.map((exam) => {
      const report = reportByExam.get(exam.id);
      const checkedAt = report?.checkedAt ?? null;
      const ageHours = checkedAt ? Math.round(((Date.parse(NOW) - Date.parse(checkedAt)) / 3_600_000) * 10) / 10 : null;
      const okSources = report?.sources.every((s) => s.ok) ?? false;
      return {
        examId: exam.id,
        verifiedAt: report?.ok ? checkedAt : null,
        ageHours,
        staleness: !okSources ? 'stale' : ageHours !== null && ageHours < 48 ? 'fresh' : ageHours !== null && ageHours < 24 * 7 ? 'aging' : 'stale',
        sourceOk: okSources,
      };
    }),
  };

  const allParsed = Object.keys(snapshot.parsedDocs).length;

  writeJson(join(STATE, 'snapshot.json'), { ...snapshot, updatedAt: NOW });
  writeJson(join(STATE, 'changelog.json'), { version: 1, events: trimmed });
  writeJson(join(STATE, 'verify.json'), verifyState);
  writeJson(join(STATE, 'citations.json'), { generatedAt: NOW, reports });
  writeJson(join(STATE, 'freshness.json'), freshness);

  // A compact feed used by the site for "live" panels.
  writeJson(join(STATE, 'feeds.json'), {
    generatedAt: NOW,
    exams: Object.values(snapshot.exams)
      .map((f) => ({
        examId: f.examId,
        title: f.title,
        sourceUrl: f.sourceUrl,
        fetchedAt: f.fetchedAt,
        examDateRaw: f.examDateRaw,
        docs: f.docs.slice(0, 8),
      }))
      .sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt)),
  });

  log('done', `${Object.keys(snapshot.exams).length} live exams, ${trimmed.length} change events (${allParsed} docs parsed), ${reports.filter((r) => r.ok).length}/${reports.length} exams fully verified`);
  if (process.exitCode) log('warn', 'some curated files failed schema validation');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
