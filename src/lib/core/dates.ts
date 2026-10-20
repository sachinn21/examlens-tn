/**
 * Date + age arithmetic.
 *
 * Indian government notifications mix `dd/mm/yyyy`, `dd.mm.yyyy` and
 * `dd-mm-yyyy` freely, and the age rule is phrased as "should not have
 * completed 35 years as on 01.07.2026". Everything here is UTC-based so the
 * result never changes with the server timezone.
 */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const pad = (n: number) => String(n).padStart(2, '0');

/** Build an ISO date, returning null for impossible dates like 31/02/2026. */
export function toISODate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * Parse the date formats found in TN recruitment notifications.
 * Returns an ISO `YYYY-MM-DD` string or null.
 */
export function parseNotificationDate(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.replace(/\s+/g, ' ').trim();

  // 2026-09-27
  let m = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return toISODate(+m[1], +m[2], +m[3]);

  // 27/09/2026, 27.09.2026, 27-09-2026
  m = s.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/);
  if (m) return toISODate(+m[3], +m[2], +m[1]);

  const monthOf = (raw: string): number | undefined => MONTHS[raw.toLowerCase().slice(0, 3)];

  // 27 Sep 2026 / 27 September, 2026
  m = s.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/);
  if (m) {
    const month = monthOf(m[2]);
    if (month) return toISODate(+m[3], month, +m[1]);
  }

  // Sep 27, 2026
  m = s.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/);
  if (m) {
    const month = monthOf(m[1]);
    if (month) return toISODate(+m[3], month, +m[2]);
  }

  return null;
}

/** Every distinct date in a block of text, in order of appearance. */
export function extractDates(text: string): string[] {
  const out: string[] = [];
  const re = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const iso = toISODate(+m[3], +m[2], +m[1]);
    if (iso) out.push(iso);
  }
  return out;
}

export interface AgeBreakdown {
  years: number;
  months: number;
  days: number;
  /** Completed years, which is what "should not have completed N years" tests. */
  completedYears: number;
  totalDays: number;
}

/** Age of `dob` on `on`, both ISO dates. */
export function ageOn(dob: string, on: string): AgeBreakdown {
  const [dy, dm, dd] = dob.split('-').map(Number);
  const [oy, om, od] = on.split('-').map(Number);
  const dobMs = Date.UTC(dy, dm - 1, dd);
  const onMs = Date.UTC(oy, om - 1, od);
  const totalDays = Math.floor((onMs - dobMs) / 86400000);

  let years = oy - dy;
  let months = om - dm;
  let days = od - dd;
  if (days < 0) {
    months -= 1;
    // days in the month preceding `on`
    const prevMonthDays = new Date(Date.UTC(oy, om - 1, 0)).getUTCDate();
    days += prevMonthDays;
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  if (totalDays < 0) return { years: 0, months: 0, days: 0, completedYears: 0, totalDays };
  return { years, months, days, completedYears: years, totalDays };
}

/** The date on which `dob` completes `years` years. */
export function birthdayFor(dob: string, years: number): string {
  const [y, m, d] = dob.split('-').map(Number);
  const targetYear = y + years;
  const lastDay = new Date(Date.UTC(targetYear, m, 0)).getUTCDate();
  return toISODate(targetYear, m, Math.min(d, lastDay)) ?? `${targetYear}-${pad(m)}-${pad(Math.min(d, lastDay))}`;
}

/** Same month/day `years` earlier, clamped to the last valid day of that month. */
export function subtractYears(iso: string, years: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const targetYear = y - years;
  const lastDay = new Date(Date.UTC(targetYear, m, 0)).getUTCDate();
  return toISODate(targetYear, m, Math.min(d, lastDay)) ?? iso;
}

export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + days * 86400000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "27 Sep 2026" — unambiguous for both Indian and international readers. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return '—';
  return `${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

/** "9 Sep 2026, 11:59 PM IST" for deadline display. */
export function formatDeadline(iso: string | null | undefined, time = '11:59 PM'): string {
  if (!iso) return '—';
  return `${formatDate(iso)}, ${time} IST`;
}

export function formatRelative(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return 'unknown';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'unknown';
  const diff = now.getTime() - then;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.round(days / 30);
  if (months < 18) return `${months} month${months === 1 ? '' : 's'} ago`;
  return `${Math.round(months / 12)} years ago`;
}

/** Days from `today` to `iso`; negative when in the past. */
export function daysUntil(iso: string | null | undefined, today = new Date()): number | null {
  if (!iso) return null;
  const target = Date.parse(`${iso}T23:59:59+05:30`);
  if (Number.isNaN(target)) return null;
  return Math.floor((target - today.getTime()) / 86400000);
}

export function isoNow(): string {
  return new Date().toISOString();
}

export function isoDateNow(): string {
  return new Date().toISOString().slice(0, 10);
}
