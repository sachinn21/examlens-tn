import type { ChangeEvent, ChangeKind, Doc, ExamFeed } from './types';
import { normalizeText } from './text';
import { extractDates, parseNotificationDate, formatDate } from './dates';

/** Stable, short, dependency-free ID for docs and change events. */
export function hashId(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  return (h1.toString(36) + h2.toString(36)).slice(0, 12);
}

/** Identity of a document: category + URL is stable even when the title is reworded. */
export function docId(doc: { category: string; url: string | null; title: string }): string {
  return hashId(`${doc.category}|${doc.url ?? normalizeText(doc.title)}`);
}

const KIND_BY_CATEGORY: Record<string, ChangeKind> = {
  Notification: 'new_notification',
  Addendum: 'new_addendum',
  'Press Release': 'new_press_release',
  'Hall Ticket': 'hall_ticket',
  'Tentative Answer Key': 'answer_key',
  'Final Answer Key': 'answer_key',
  Result: 'result_published',
  'Question Papers': 'doc_published',
  'Apply Online': 'application_window_changed',
};

export function kindForCategory(category: string): ChangeKind {
  return KIND_BY_CATEGORY[category] ?? 'doc_published';
}

export function toDatedDoc(doc: { category: string; title: string; url: string | null; uploadedAt: string | null }, now: string): Doc {
  return {
    id: docId(doc),
    category: doc.category,
    title: doc.title,
    url: doc.url,
    uploadedAt: parseNotificationDate(doc.uploadedAt) ?? doc.uploadedAt,
    firstSeenAt: now,
  };
}

export interface RawDiff {
  kind: ChangeKind;
  field: string | null;
  before: string | null;
  after: string | null;
  doc?: Doc;
  summary: string;
}

const DOC_LABEL: Partial<Record<ChangeKind, string>> = {
  new_addendum: 'New addendum published',
  new_press_release: 'New press release published',
  hall_ticket: 'Hall ticket released',
  answer_key: 'Answer key published',
  result_published: 'Result published',
  new_notification: 'New notification published',
  doc_published: 'New document published',
  application_window_changed: 'Application window updated',
};

/** Compare the previously stored feed for one exam against a fresh fetch. */
export function diffFeed(prev: ExamFeed | null, next: ExamFeed, isBaseline: boolean): RawDiff[] {
  const diffs: RawDiff[] = [];
  if (isBaseline || !prev) return diffs;

  const prevById = new Map(prev.docs.map((d) => [d.id, d]));
  const nextById = new Map(next.docs.map((d) => [d.id, d]));

  for (const [id, doc] of nextById) {
    if (!prevById.has(id)) {
      const kind = kindForCategory(doc.category);
      diffs.push({
        kind,
        field: doc.category,
        before: null,
        after: doc.title,
        doc,
        summary: `${DOC_LABEL[kind] ?? 'Document published'}: ${trim(doc.title, 110)}`,
      });
    }
  }

  for (const [id, doc] of prevById) {
    if (!nextById.has(id)) {
      diffs.push({
        kind: 'doc_removed',
        field: doc.category,
        before: doc.title,
        after: null,
        summary: `Document withdrawn from the official list: ${trim(doc.title, 110)}`,
      });
    }
  }

  if ((prev.examDateRaw ?? '') !== (next.examDateRaw ?? '')) {
    const before = prev.examDateRaw ? (extractDates(prev.examDateRaw)[0] ?? null) : null;
    const after = next.examDateRaw ? (extractDates(next.examDateRaw)[0] ?? null) : null;
    diffs.push({
      kind: 'exam_date_changed',
      field: 'examDate',
      before: before ?? prev.examDateRaw,
      after: after ?? next.examDateRaw,
      summary:
        before && after
          ? `Exam date changed from ${formatDate(before)} to ${formatDate(after)}`
          : `Exam date line changed: “${trim(next.examDateRaw ?? 'removed from the dashboard', 90)}”`,
    });
  }

  if ((prev.applyRaw ?? '') !== (next.applyRaw ?? '')) {
    diffs.push({
      kind: 'application_window_changed',
      field: 'applicationWindow',
      before: prev.applyRaw,
      after: next.applyRaw,
      summary: 'Application window dates were updated on the official dashboard',
    });
  }

  return diffs;
}

export function makeChangeEvent(args: {
  examId: string;
  examName: string;
  diff: RawDiff;
  detectedAt: string;
  effectiveAt: string | null;
  sourceUrl: string;
  sourceTitle: string;
  evidence?: string | null;
  confidence?: ChangeEvent['confidence'];
}): ChangeEvent {
  const { examId, examName, diff, detectedAt, effectiveAt, sourceUrl, sourceTitle } = args;
  return {
    // Identity is semantic, not temporal: a re-detection of the same change
    // must not create a second entry.
    id: hashId(
      `${examId}|${diff.kind}|${diff.field ?? ''}|${diff.before ?? ''}|${diff.after ?? ''}|${effectiveAt ?? ''}`,
    ),
    examId,
    examName,
    kind: diff.kind,
    effectiveAt,
    detectedAt,
    field: diff.field,
    before: diff.before,
    after: diff.after,
    summary: diff.summary,
    sourceUrl,
    sourceTitle,
    evidence: args.evidence ?? null,
    confidence: args.confidence ?? 'official',
  };
}

/**
 * Read a date change out of an addendum / press release.
 *
 * Real examples handled:
 *  "has been postponed from 06.09.2026 to 27.09.2026"
 *  "rescheduled from 27.09.2026 to 04.10.2026"
 *  "dated 23.06.2026 ... revised from 06.09.2026 to 27.09.2026"
 */
export function parseOfficialDateChange(text: string): {
  before: string;
  after: string;
  quote: string;
  kind: 'exam_date_changed';
} | null {
  const flat = text.replace(/\s+/g, ' ');
  const patterns = [
    /postpon\w*[^.]{0,140}?from\s+(\d{1,2}[./-]\d{1,2}[./-]\d{4})\s*(?:to|and)\s*(\d{1,2}[./-]\d{1,2}[./-]\d{4})/i,
    /reschedul\w*[^.]{0,140}?from\s+(\d{1,2}[./-]\d{1,2}[./-]\d{4})\s*(?:to|and)\s*(\d{1,2}[./-]\d{1,2}[./-]\d{4})/i,
    /(?:changed|revised|shifted)\s*(?:the date)?[^.]{0,80}?from\s+(\d{1,2}[./-]\d{1,2}[./-]\d{4})\s*(?:to|and)\s*(\d{1,2}[./-]\d{1,2}[./-]\d{4})/i,
  ];
  for (const re of patterns) {
    const m = flat.match(re);
    if (m) {
      const before = parseNotificationDate(m[1]);
      const after = parseNotificationDate(m[2]);
      if (before && after) {
        const start = Math.max(0, (m.index ?? 0) - 40);
        return {
          before,
          after,
          quote: flat.slice(start, (m.index ?? 0) + m[0].length + 40).trim(),
          kind: 'exam_date_changed',
        };
      }
    }
  }
  return null;
}

/**
 * Pull the sentence that mentions vacancies. Sentences are split on a terminator
 * followed by a capital letter or bracket, so abbreviations like "No. 06/2026"
 * do not cut a sentence in half.
 */
export function vacancyEvidence(text: string): string | null {
  const flat = text.replace(/\s+/g, ' ').trim();
  const sentences = flat.split(/(?<=[.!?])\s+(?=[A-Z(])/);
  const hit = sentences.find((s) => /vacanc/i.test(s));
  if (!hit) return null;
  const trimmed = hit.trim().slice(0, 320);
  return /[:;,]$/.test(trimmed) ? `${trimmed.slice(0, -1)} …` : trimmed;
}

/** "Addendum for Notification No.05/2026 ADDENDUM (5A/2026)" -> "5A/2026" */
export function addendumRef(title: string): string | null {
  const m = title.match(/addendum\s*\(?\s*([0-9]{1,3}[A-Z]?\s*\/\s*[0-9]{4})/i);
  return m ? m[1].replace(/\s+/g, '') : null;
}

/** Does an addendum revise the number of vacancies? */
export function mentionsVacancyRevision(text: string): boolean {
  const t = normalizeText(text);
  return /number of vacancies|vacancies (?:are )?revised|revised as follows/.test(t);
}

function trim(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}
