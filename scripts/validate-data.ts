#!/usr/bin/env tsx
/**
 * CI gate. Fails the build when the dataset is not trustworthy:
 *
 *  1. every curated file must satisfy the schema (including a verbatim citation)
 *  2. every citation must still be found in the official document
 *  3. the last successful verification must be recent
 *  4. each exam must have dates, a working official link and a summary
 *
 * Run after `pnpm refresh` in CI, and locally before opening a PR.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExamSchema, type Exam } from '../src/lib/core/types';
import type { CitationReport } from '../src/lib/ingest/verify';
import type { Freshness } from '../src/lib/core/types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const STATE = join(DATA, 'state');
const MAX_AGE_HOURS = Number(process.env.MAX_STALENESS_HOURS ?? 72);
const args = process.argv.slice(2);
const strict = !args.includes('--no-strict');

let failures = 0;
let warnings = 0;

const fail = (msg: string) => {
  failures++;
  console.error(`✗ ${msg}`);
};
const warn = (msg: string) => {
  warnings++;
  console.warn(`! ${msg}`);
};
const ok = (msg: string) => console.log(`✓ ${msg}`);

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/* 1. schema */
const dir = join(DATA, 'curated', 'exams');
const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
const exams: Exam[] = [];

for (const file of files) {
  const parsed = ExamSchema.safeParse(JSON.parse(readFileSync(join(dir, file), 'utf8')));
  if (!parsed.success) {
    fail(`${file}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    continue;
  }
  const exam = parsed.data;
  exams.push(exam);

  if (exam.slug !== exam.id) fail(`${file}: slug "${exam.slug}" must equal id "${exam.id}"`);
  if (!exam.summary || exam.summary.length < 40) fail(`${file}: summary is too thin`);
  if (!exam.officialLinks.notification.startsWith('https://')) fail(`${file}: notification link must be https`);
  if (exam.maintenance === 'verified') {
    if (!exam.ageRules.length && exam.hasAgeLimit) fail(`${file}: verified exam has no age rule and no explicit no-age-limit flag`);
    for (const rule of exam.ageRules) {
      if (rule.maxAge && rule.maxAge.general === null) fail(`${file}: ${rule.id} has a null general ceiling — use maxAge: null for "no limit"`);
      if (rule.cutoff < '2020-01-01') fail(`${file}: ${rule.id} cut-off looks wrong (${rule.cutoff})`);
      if (!rule.citation.values.length) warn(`${file}: ${rule.id} has no numeric fingerprint for its table values`);
    }
    if (!exam.sources.length) fail(`${file}: verified exam must list its sources`);
  }
  ok(`${file} — schema`);
}

/* 2. citations */
const citations = readJson<{ generatedAt: string; reports: CitationReport[] }>(join(STATE, 'citations.json'), {
  generatedAt: '',
  reports: [],
});
const reports = new Map(citations.reports.map((r) => [r.examId, r]));
for (const exam of exams) {
  const report = reports.get(exam.id);
  if (!report) {
    (strict ? fail : warn)(`${exam.id}: no citation report — run \`pnpm refresh\` before validating`);
    continue;
  }
  if (report.issues.length) {
    for (const issue of report.issues) {
      fail(`${exam.id}: citation not found (${issue.where}) — "${issue.quote.slice(0, 60)}…"`);
    }
  } else {
    ok(`${exam.id} — ${report.sources.reduce((n, s) => n + s.citationsPassed, 0)} citations verified`);
  }
  const bad = report.sources.filter((s) => !s.ok);
  for (const s of bad) (strict ? fail : warn)(`${exam.id}: source ${s.sourceId} unreachable — ${s.error ?? `HTTP ${s.status}`}`);
}

/* 3. freshness */
const freshness = readJson<Freshness | null>(join(STATE, 'freshness.json'), null);
if (!freshness) {
  (strict ? fail : warn)('no freshness report');
} else {
  const ageHours = (Date.now() - Date.parse(freshness.generatedAt)) / 3_600_000;
  if (ageHours > MAX_AGE_HOURS) fail(`dataset is ${ageHours.toFixed(1)}h old (limit ${MAX_AGE_HOURS}h)`);
  else ok(`last refresh ${ageHours.toFixed(1)}h ago`);
  for (const e of freshness.exams) {
    if (!e.sourceOk) (strict ? fail : warn)(`${e.examId}: a cited source is failing`);
  }
}

/* 4. dataset sanity */
const ids = new Set<string>();
const notifs = new Set<string>();
for (const e of exams) {
  if (ids.has(e.id)) fail(`duplicate id ${e.id}`);
  ids.add(e.id);
  const key = `${e.board}:${e.notificationNo}`;
  if (notifs.has(key)) fail(`duplicate notification ${key}`);
  notifs.add(key);
  if (e.dates.applyStart && e.dates.applyEnd && e.dates.applyStart > e.dates.applyEnd) {
    fail(`${e.id}: application window ends before it starts`);
  }
  if (e.dates.notification && e.dates.applyStart && e.dates.applyStart < e.dates.notification) {
    warn(`${e.id}: applications open before the notification date`);
  }
}

const changelog = readJson<{ events: unknown[] }>(join(STATE, 'changelog.json'), { events: [] });
ok(`${exams.length} curated exams, ${freshness?.sources.length ?? 0} board endpoints, ${changelog.events.length} logged changes`);

if (warnings) console.warn(`\n${warnings} warning(s)`);
if (failures) {
  console.error(`\n${failures} failure(s) — refusing to publish`);
  process.exit(1);
}
console.log('\nAll checks passed.');
