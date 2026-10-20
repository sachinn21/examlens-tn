import { fetchResource, NotModifiedError, type FetchResult } from './http';
import { extractPdf, htmlToText } from './pdf';
import { findQuote, normalizeText, sha256Hex, type CitationIssue } from '../core/text';
import type { Exam, Source } from '../core/types';

export interface SourceCheck {
  sourceId: string;
  url: string;
  kind: 'html' | 'pdf';
  status: number | null;
  ok: boolean;
  sha256: string | null;
  bytes: number | null;
  pageCount: number | null;
  notModified: boolean;
  error: string | null;
  checkedAt: string;
  citationsChecked: number;
  citationsPassed: number;
}

export interface CitationReport {
  examId: string;
  checkedAt: string;
  sources: SourceCheck[];
  issues: CitationIssue[];
  ok: boolean;
  changedSources: string[];
}

interface CachedResult {
  ok: boolean;
  page?: number;
  score: number;
  /** Fingerprint of the quote, so editing a citation invalidates the cache. */
  q: string;
}

interface CachedSource {
  sha256: string;
  etag: string | null;
  lastModified: string | null;
  checkedAt: string;
  results?: Record<string, CachedResult>;
}

export interface VerifyState {
  [key: string]: CachedSource;
}

interface CitedFact {
  where: string;
  sourceId?: string;
  page?: number;
  quote: string;
  values: Array<number | string>;
}

function collectCitations(exam: Exam): CitedFact[] {
  const out: CitedFact[] = [];
  exam.ageRules.forEach((r) =>
    out.push({ where: `ageRules.${r.id}`, sourceId: r.citation.sourceId, page: r.citation.page, quote: r.citation.quote, values: r.citation.values }),
  );
  exam.qualifications.forEach((q, i) =>
    out.push({ where: `qualifications.${i}`, sourceId: q.citation.sourceId, page: q.citation.page, quote: q.citation.quote, values: q.citation.values }),
  );
  exam.specialRequirements.forEach((s) => {
    if (s.citation) {
      out.push({ where: `specialRequirements.${s.id}`, sourceId: s.citation.sourceId, page: s.citation.page, quote: s.citation.quote, values: s.citation.values });
    }
  });
  return out;
}

/** Numeric fingerprint taken from a value like "01.09.2025" -> [1, 9, 2025]. */
function numericTokens(values: Array<number | string>): number[] {
  return values
    .flatMap((v) => String(v).match(/\d+/g) ?? [])
    .map(Number)
    .filter((n) => Number.isFinite(n));
}

/**
 * Check that table-derived numbers still appear on the cited page. A presence
 * check, not a semantic one: it catches a table being replaced, and a human
 * still reviews anything that trips it.
 */
function verifyNumbers(values: number[], pages: string[], hintPage?: number): { ok: boolean; missing: number[]; page?: number } {
  if (!values.length) return { ok: true, missing: [] };
  const candidates = hintPage ? [pages[hintPage - 1] ?? '', ...pages] : pages;
  let best: { ok: boolean; missing: number[]; page?: number } = { ok: false, missing: values };
  for (let i = 0; i < candidates.length; i++) {
    const nums = new Set((candidates[i].match(/\d{1,4}/g) ?? []).map(Number));
    const missing = values.filter((v) => !nums.has(v));
    if (missing.length === 0) return { ok: true, missing: [], page: hintPage && i === 0 ? hintPage : i + 1 };
    if (missing.length < best.missing.length) best = { ok: false, missing, page: i + 1 };
  }
  return best;
}

function defaultSources(exam: Exam): Source[] {
  if (exam.sources.length) return exam.sources;
  return [
    {
      id: 'notification',
      authority: exam.boardName,
      title: `${exam.shortName} notification`,
      url: exam.officialLinks.notification,
      kind: 'pdf',
      language: 'en',
    },
  ];
}

async function readDocument(
  source: Source,
  res: FetchResult,
): Promise<{ pages: string[]; sha256: string; pageCount: number }> {
  if (source.kind === 'pdf') {
    const pdf = await extractPdf(res.bytes);
    return { pages: pdf.pages, sha256: pdf.sha256, pageCount: pdf.pageCount };
  }
  return { pages: [htmlToText(res.text)], sha256: await sha256Hex(res.bytes), pageCount: 1 };
}

export interface VerifyOptions {
  state: VerifyState;
  now: string;
  offline?: boolean;
  timeoutMs?: number;
}

/**
 * Fetch every source an exam cites, extract its text and assert each citation
 * still exists. Conditional requests avoid re-downloading unchanged PDFs; a 304
 * replays stored per-citation results only when the quotes themselves are
 * unchanged, so a "verified" count is never invented.
 */
export async function verifyExamSources(exam: Exam, opts: VerifyOptions): Promise<CitationReport> {
  const { state, now, offline, timeoutMs = 30_000 } = opts;
  const sources: SourceCheck[] = [];
  const issues: CitationIssue[] = [];
  const changed: string[] = [];
  const citations = collectCitations(exam);
  const sourceList = defaultSources(exam);

  for (const source of sourceList) {
    const key = `${exam.id}::${source.id}`;
    const cached = state[key];
    const mine = citations.filter((c) => (c.sourceId ?? sourceList[0].id) === source.id);
    const check: SourceCheck = {
      sourceId: source.id,
      url: source.url,
      kind: source.kind,
      status: null,
      ok: false,
      sha256: cached?.sha256 ?? null,
      bytes: null,
      pageCount: null,
      notModified: false,
      error: null,
      checkedAt: now,
      citationsChecked: 0,
      citationsPassed: 0,
    };

    if (offline) {
      check.ok = Boolean(cached);
      check.error = cached ? null : 'offline and never fetched';
      sources.push(check);
      continue;
    }

    let sourceIssues = 0;

    /** Replay cached per-citation verdicts for a 304, if still applicable. */
    const replay = (): boolean => {
      if (!cached?.results) return false;
      const fingerprint = (c: CitedFact) => `${normalizeText(c.quote)}|${JSON.stringify(c.values)}|${c.page ?? ''}`;
      if (mine.some((c) => cached.results![c.where]?.q !== fingerprint(c))) return false;
      for (const cit of mine) {
        const r = cached.results[cit.where];
        if (!r) return false;
        check.citationsChecked++;
        if (r.ok) check.citationsPassed++;
        else {
          sourceIssues++;
          issues.push({ examId: exam.id, where: cit.where, quote: cit.quote, page: r.page ?? cit.page, score: r.score });
        }
      }
      check.ok = sourceIssues === 0;
      return true;
    };

    try {
      let res: FetchResult;
      try {
        res = await fetchResource(source.url, {
          timeoutMs,
          retries: 1,
          etag: cached?.etag ?? null,
          lastModified: cached?.lastModified ?? null,
        });
      } catch (err) {
        if (err instanceof NotModifiedError && replay()) {
          check.status = 304;
          check.notModified = true;
          check.sha256 = cached!.sha256;
          if (cached) state[key] = { ...cached, checkedAt: now };
          sources.push(check);
          continue;
        }
        // A 304 we cannot replay (new or edited citation) falls through to a full fetch.
        res = await fetchResource(source.url, { timeoutMs, retries: 1 });
      }

      check.status = res.status;
      check.bytes = res.bytes.byteLength;
      const doc = await readDocument(source, res);
      check.sha256 = doc.sha256;
      check.pageCount = doc.pageCount;

      if (cached && cached.sha256 !== doc.sha256 && source.kind === 'pdf') changed.push(source.id);

      const results: Record<string, CachedResult> = {};
      const numericFallback = source.language === 'ta';
      const docNumbers = numericFallback
        ? new Set((doc.pages.join(' ').match(/\d{1,3}/g) ?? []).map((n) => Number(n)))
        : null;

      for (const cit of mine) {
        check.citationsChecked++;
        if (numericFallback) {
          const wanted = numericTokens(cit.values);
          const pass = wanted.length > 0 && wanted.every((n) => docNumbers!.has(n));
          results[cit.where] = { ok: pass, score: pass ? 1 : 0, q: `${normalizeText(cit.quote)}|${JSON.stringify(cit.values)}|${cit.page ?? ''}` };
          if (pass) check.citationsPassed++;
          else sourceIssues++;
          continue;
        }

        const match = findQuote(cit.quote, doc.pages);
        const numbers = verifyNumbers(numericTokens(cit.values), doc.pages, cit.page);
        const pass = match.found && numbers.ok;
        results[cit.where] = {
          ok: pass,
          page: match.page ?? cit.page,
          score: match.found ? (numbers.ok ? 1 : 0.5) : 0,
          q: `${normalizeText(cit.quote)}|${JSON.stringify(cit.values)}|${cit.page ?? ''}`,
        };
        if (pass) {
          check.citationsPassed++;
        } else if (!match.found) {
          sourceIssues++;
          issues.push({
            examId: exam.id,
            where: cit.where,
            quote: cit.quote,
            page: match.page ?? cit.page,
            score: match.score,
            snippet: match.snippet,
          });
        } else {
          sourceIssues++;
          issues.push({
            examId: exam.id,
            where: cit.where,
            quote: cit.quote,
            page: numbers.page ?? cit.page,
            score: 0.5,
            snippet: `Text found, but these table values are missing from the page: ${numbers.missing.join(', ')}`,
          });
        }
      }

      state[key] = { sha256: doc.sha256, etag: res.etag, lastModified: res.lastModified, checkedAt: now, results };
      check.ok = res.ok && sourceIssues === 0;
      if (!res.ok) check.error = `HTTP ${res.status}`;
    } catch (err) {
      check.ok = false;
      check.error = err instanceof Error ? err.message : String(err);
    }

    sources.push(check);
  }

  const failed = sources.filter((s) => !s.ok);
  return {
    examId: exam.id,
    checkedAt: now,
    sources,
    issues,
    ok: failed.length === 0 && issues.length === 0,
    changedSources: changed,
  };
}

/** Human-readable one-liner for a stale citation, used in the UI banner. */
export function describeIssue(issue: CitationIssue): string {
  return `“${normalizeText(issue.quote).slice(0, 80)}…” is no longer present in the official document${
    issue.page ? ` (searched around page ${issue.page})` : ''
  }.`;
}
