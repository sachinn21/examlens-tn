/**
 * Shared vocabulary. Kept free of zod so the browser bundle can import the
 * labels and ranking tables without pulling a validation library.
 */

export const CATEGORIES = ['general', 'bc', 'bcm', 'mbc_dc', 'sc', 'sca', 'st'] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  general: 'General / Others',
  bc: 'BC (OBCM)',
  bcm: 'BC Muslim',
  mbc_dc: 'MBC / Denotified Community',
  sc: 'Scheduled Caste',
  sca: 'SC (Arunthathiyar)',
  st: 'Scheduled Tribe',
};

/** Reservation categories that share the 5-year age concession in TNPSC notifications. */
export const RELAXED_CATEGORIES: Category[] = ['bc', 'bcm', 'mbc_dc', 'sc', 'sca', 'st'];

export const QUALIFICATION_LEVELS = [
  'none',
  'sslc',
  'hsc',
  'iti',
  'diploma',
  'degree',
  'pg',
] as const;
export type QualificationLevel = (typeof QUALIFICATION_LEVELS)[number];

/** Ordering used only for "is the user's qualification at least X" checks. */
export const QUALIFICATION_RANK: Record<QualificationLevel, number> = {
  none: 0,
  sslc: 10,
  hsc: 12,
  iti: 12,
  diploma: 13,
  degree: 15,
  pg: 17,
};

export const QUALIFICATION_LABELS: Record<QualificationLevel, string> = {
  none: 'No formal qualification',
  sslc: '10th / SSLC',
  hsc: '12th / HSC',
  iti: 'ITI certificate',
  diploma: 'Diploma (polytechnic)',
  degree: 'Bachelor’s degree',
  pg: 'Post-graduate degree',
};

export const GENDERS = ['male', 'female', 'other'] as const;
export type Gender = (typeof GENDERS)[number];


/**
 * Notification numbers appear as "05/2026", "5/2026" or "5 / 2026" across the
 * dashboard, the PDF cover and the archive. One canonical form for matching.
 */
export function normalizeNotificationNo(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.replace(/\s+/g, '').match(/(\d{1,3})\/(\d{4})/);
  if (!m) return null;
  return `${Number(m[1])}/${m[2]}`;
}

/** Stable id for a notification that has no hand-curated record. */
export function trackedExamId(raw: string | null | undefined): string | null {
  const n = normalizeNotificationNo(raw);
  return n ? `tnpsc-${n.replace('/', '-')}` : null;
}
