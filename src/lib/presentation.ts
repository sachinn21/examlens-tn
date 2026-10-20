import type { AgeRule, ChangeKind, Exam, ExamStatus, Category } from './core/types';
import { CATEGORY_LABELS, RELAXED_CATEGORIES } from './core/types';
import { addDays, daysUntil, formatDate } from './core/dates';
import type { SiteExam } from './server/data';

export function liveStatus(exam: Exam, now = new Date()): ExamStatus {
  const applyEnd = exam.dates.applyEnd ? daysUntil(exam.dates.applyEnd, now) : null;
  const applyStart = exam.dates.applyStart ? daysUntil(exam.dates.applyStart, now) : null;
  const examDay = exam.dates.examDate ? daysUntil(exam.dates.examDate, now) : null;
  if (applyStart !== null && applyStart > 0) return 'upcoming';
  if (applyEnd !== null && applyEnd >= 0) return 'open';
  if (examDay !== null && examDay >= 0) return 'closed';
  if (exam.status === 'result') return 'result';
  return 'archived';
}

export const STATUS_LABEL: Record<string, string> = {
  open: 'Applications open',
  upcoming: 'Opens soon',
  closed: 'Applications closed',
  result: 'Result stage',
  archived: 'Archived',
};

export function statusBadgeClass(status: string): string {
  if (status === 'open') return 'badge-ok';
  if (status === 'upcoming') return 'badge-warn';
  if (status === 'result') return 'badge-neutral';
  return 'badge-neutral';
}

export const CHANGE_LABEL: Record<ChangeKind, string> = {
  exam_date_changed: 'Exam date changed',
  application_window_changed: 'Application window changed',
  new_addendum: 'Addendum issued',
  new_press_release: 'Press release',
  vacancies_revised: 'Vacancies revised',
  rule_changed: 'Rule changed',
  result_published: 'Result published',
  hall_ticket: 'Hall ticket',
  answer_key: 'Answer key',
  new_notification: 'New notification',
  doc_published: 'Document published',
  doc_removed: 'Document withdrawn',
};

export function changeTone(kind: ChangeKind): 'ok' | 'warn' | 'bad' | 'neutral' {
  if (kind === 'exam_date_changed' || kind === 'rule_changed' || kind === 'doc_removed') return 'bad';
  if (kind === 'new_addendum' || kind === 'vacancies_revised' || kind === 'application_window_changed') return 'warn';
  if (kind === 'new_notification' || kind === 'result_published') return 'ok';
  return 'neutral';
}

export function stalenessLabel(s: SiteExam['freshness']): { text: string; tone: 'ok' | 'warn' | 'bad' | 'neutral' } {
  if (s.staleness === 'fresh') return { text: 'Verified today', tone: 'ok' };
  if (s.staleness === 'aging') return { text: 'Verified this week', tone: 'neutral' };
  if (s.staleness === 'stale') return { text: 'Needs re-check', tone: 'warn' };
  return { text: 'Not yet verified', tone: 'neutral' };
}

export interface AgeRow {
  category: Category;
  label: string;
  min: number | null;
  max: number | null;
  pwd: number | null;
  exsm: number | null;
  widow: number | null;
}

function concessionValue(
  rule: AgeRule,
  key: 'pwd' | 'exServicemen' | 'destituteWidow',
  base: number | null,
  category: Category,
): number | null {
  const c = rule.concessions[key];
  if (!c || c.mode === 'blocked') return null;
  if (base === null) return null;
  const limit = c.byCategory?.[category] ?? c.value;
  return c.mode === 'absolute' ? limit : base + limit;
}

/** Flatten an age rule into one row per community category for display. */
export function ageMatrix(rule: AgeRule): AgeRow[] {
  const cats: Category[] = ['general', 'bc', 'bcm', 'mbc_dc', 'sc', 'sca', 'st'];
  return cats.map((category) => {
    const max = rule.maxAge === null ? null : (rule.maxAge[category] ?? rule.maxAge.general ?? null);
    return {
      category,
      label: CATEGORY_LABELS[category],
      min: rule.minAge,
      max,
      pwd: concessionValue(rule, 'pwd', max, category),
      exsm: concessionValue(rule, 'exServicemen', max, category),
      widow: concessionValue(rule, 'destituteWidow', max, category),
    };
  });
}

/** The rule that describes the bulk of an examination's posts. */
export function primaryAgeRule(exam: { ageRules: AgeRule[] }): AgeRule | undefined {
  return exam.ageRules.find((r) => r.id === 'most-posts' || r.id === 'standard-posts' || r.id === 'all-posts') ?? exam.ageRules[0];
}

export function isRelaxed(category: Category): boolean {
  return RELAXED_CATEGORIES.includes(category);
}

export function formatWindow(start: string | null, end: string | null): string {
  if (!start && !end) return 'Not stated';
  if (start && !end) return `From ${formatDate(start)}`;
  if (!start && end) return `Until ${formatDate(end)}`;
  return `${formatDate(start)} to ${formatDate(end)}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** ICS calendar for every deadline in the dataset. */
export function buildCalendar(exams: SiteExam[], now = new Date()): string {
  const dt = (iso: string) => iso.replace(/-/g, '');
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ExamLens//Tamil Nadu exam deadlines//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Tamil Nadu exam deadlines (ExamLens)',
    'X-WR-TIMEZONE:Asia/Kolkata',
  ];
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  for (const exam of exams) {
    const push = (date: string, title: string, kind: 'start' | 'end' | 'exam') => {
      const uid = `${exam.id}-${kind}-${date}@examlens`;
      lines.push(
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${dt(date)}`,
        `DTEND;VALUE=DATE:${dt(addDays(date, 1))}`,
        `SUMMARY:${icsEscape(title)}`,
        `DESCRIPTION:${icsEscape(`${exam.name} (${exam.notificationNo}). Source: ${exam.officialLinks.notification}`)}`,
        `URL:${exam.officialLinks.notification}`,
        'BEGIN:VALARM',
        'TRIGGER:-P7D',
        'ACTION:DISPLAY',
        `DESCRIPTION:${icsEscape(`7 days: ${title}`)}`,
        'END:VALARM',
        'END:VEVENT',
      );
    };
    if (exam.dates.applyStart) push(exam.dates.applyStart, `${exam.shortName}: applications open`, 'start');
    if (exam.dates.applyEnd) push(exam.dates.applyEnd, `${exam.shortName}: last date to apply`, 'end');
    if (exam.dates.examDate) push(exam.dates.examDate, `${exam.shortName}: exam day`, 'exam');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
