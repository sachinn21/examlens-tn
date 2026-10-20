import { z } from 'zod';
import { CATEGORIES, QUALIFICATION_LEVELS, GENDERS } from './constants';
import type { Category } from './constants';

/**
 * ExamLens data model.
 *
 * Every factual claim in an exam record carries a Citation with a verbatim
 * quote. `scripts/validate-data.ts` re-extracts text from the official source
 * PDF/HTML and asserts the quote is present, so a rule can never drift away
 * from the document it claims to come from without the build failing.
 */

export * from './constants';

/** ------------------------------------------------------------------ */
/** Citations & provenance                                              */
/** ------------------------------------------------------------------ */

export const CitationSchema = z.object({
  /** Verbatim text that must appear inside the source document. */
  quote: z.string().min(8),
  /**
   * Numbers that must also appear on the cited page. Used for facts taken from
   * a table, where the values themselves cannot be quoted as a sentence.
   */
  values: z.array(z.union([z.number(), z.string()])).default([]),
  /** 1-based page number in the PDF, when known. */
  page: z.number().int().positive().optional(),
  /** Overrides the exam-level source when a fact comes from an addendum etc. */
  sourceId: z.string().optional(),
  note: z.string().optional(),
});
export type Citation = z.infer<typeof CitationSchema>;

/** Rejects javascript:/data: URLs before they can reach an href. */
export const HttpUrl = z
  .string()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), { message: 'Only http(s) URLs are allowed' });

export const SourceSchema = z.object({
  id: z.string(),
  authority: z.string(),
  title: z.string(),
  url: HttpUrl,
  /** 'html' pages are fetched and text-extracted; 'pdf' goes through unpdf. */
  kind: z.enum(['html', 'pdf']),
  language: z.enum(['en', 'ta']).default('en'),
  /** Human-readable location of the rule inside the document. */
  locator: z.string().optional(),
  retrievedAt: z.string().optional(),
  sha256: z.string().optional(),
  bytes: z.number().optional(),
});
export type Source = z.infer<typeof SourceSchema>;

/** ------------------------------------------------------------------ */
/** Eligibility rules                                                   */
/** ------------------------------------------------------------------ */

export const ConcessionSchema = z.object({
  /**
   * absolute = the table states a flat maximum (e.g. PwBD 44)
   * add      = years added to the base limit
   * blocked  = the notification says this category cannot apply to the post
   */
  mode: z.enum(['absolute', 'add', 'blocked']).default('absolute'),
  value: z.number().int().nonnegative(),
  /**
   * Some TN tables give a different ceiling per community (PwBD 40 for general,
   * 42 for BC/MBC, 45 for SC/ST). When present this overrides `value`.
   */
  byCategory: z.record(z.enum(CATEGORIES), z.number().int()).optional(),
  note: z.string().optional(),
});
export type Concession = z.infer<typeof ConcessionSchema>;

export const AgeRuleSchema = z.object({
  id: z.string(),
  label: z.string(),
  /** Post codes / names this rule covers. Empty = applies to the whole exam. */
  appliesTo: z.object({
    postCodes: z.array(z.string()).default([]),
    postNames: z.array(z.string()).default([]),
    gender: z.enum(['male', 'female', 'any']).default('any'),
  }).default({ postCodes: [], postNames: [], gender: 'any' }),
  /** "as on" date from the notification, ISO. */
  cutoff: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  minAge: z.number().int().nonnegative(),
  /** null = the notification states "No maximum age limit". */
  maxAge: z.record(z.enum(CATEGORIES), z.number().int().nullable()).nullable(),
  concessions: z.object({
    pwd: ConcessionSchema.nullable().default(null),
    exServicemen: ConcessionSchema.nullable().default(null),
    destituteWidow: ConcessionSchema.nullable().default(null),
  }).default({ pwd: null, exServicemen: null, destituteWidow: null }),
  /**
   * Group IV prints "#": no maximum age at all for reserved-category candidates
   * whose general educational qualification is above the post's minimum.
   */
  higherQualificationMax: z
    .object({
      aboveLevel: z.enum(QUALIFICATION_LEVELS),
      max: z.number().int(),
      categories: z.enum(['reserved', 'all']).default('reserved'),
    })
    .optional(),
  notes: z.string().optional(),
  citation: CitationSchema,
});
export type AgeRule = z.infer<typeof AgeRuleSchema>;

export const QualificationRuleSchema = z.object({
  postCodes: z.array(z.string()).default([]),
  postNames: z.array(z.string()).default([]),
  /** Minimum level required, when it can be expressed as a level. */
  minLevel: z.enum(QUALIFICATION_LEVELS).default('none'),
  /** If true the exact subject/degree matters and the engine returns "needs check". */
  fieldSpecific: z.boolean().default(false),
  summary: z.string(),
  acceptedAlternatives: z.array(z.string()).default([]),
  citation: CitationSchema,
});
export type QualificationRule = z.infer<typeof QualificationRuleSchema>;

export const SpecialRequirementSchema = z.object({
  id: z.string(),
  label: z.string(),
  /** 'blocking' means failing it makes the candidate ineligible. */
  severity: z.enum(['blocking', 'info']).default('blocking'),
  /** Machine-checkable requirements; free-text ones stay 'info'. */
  autoCheck: z
    .enum(['female-only', 'tamil-sslc', 'no-pwd', 'physical-standards', 'tn-resident', 'serving-teacher', 'none'])
    .default('none'),
  detail: z.string(),
  citation: CitationSchema.optional(),
});
export type SpecialRequirement = z.infer<typeof SpecialRequirementSchema>;

/** ------------------------------------------------------------------ */
/** Exams                                                               */
/** ------------------------------------------------------------------ */

export const EXAM_STATUS = ['open', 'upcoming', 'closed', 'result', 'archived'] as const;
export type ExamStatus = (typeof EXAM_STATUS)[number];

export const DateWindowSchema = z.object({
  start: z.string().nullable().default(null),
  end: z.string().nullable().default(null),
  /** Raw text exactly as printed on the official page. */
  raw: z.string().optional(),
  /** Extra human notes, e.g. "extended by addendum 5A/2026". */
  note: z.string().optional(),
});
export type DateWindow = z.infer<typeof DateWindowSchema>;

export const ExamSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  board: z.enum(['tnpsc', 'tnusrb', 'trb', 'tn-health', 'other']),
  boardName: z.string(),
  name: z.string(),
  shortName: z.string(),
  /** Exam / notification number, e.g. "11/2026". */
  notificationNo: z.string(),
  slug: z.string(),
  year: z.number().int(),
  status: z.enum(EXAM_STATUS),
  /** Tamil name where the official notification provides one. */
  tamilName: z.string().optional(),
  level: z.enum(['group-1', 'group-2', 'group-4', 'technical', 'police', 'teacher', 'other']),
  summary: z.string(),
  /** Why this exam matters / who it is for. 1-2 sentences, original copy. */
  whyItMatters: z.string(),
  dates: z.object({
    notification: z.string().nullable().default(null),
    applyStart: z.string().nullable().default(null),
    applyEnd: z.string().nullable().default(null),
    examDate: z.string().nullable().default(null),
    examDateRaw: z.string().optional(),
    resultDate: z.string().nullable().default(null),
    cutoffAgeDate: z.string().nullable().default(null),
  }),
  vacancies: z.object({
    total: z.number().int().nullable().default(null),
    note: z.string().optional(),
    breakdown: z.array(z.object({ post: z.string(), count: z.number().int() })).default([]),
  }).default({ total: null, breakdown: [] }),
  fee: z.object({
    amount: z.number().nullable().default(null),
    note: z.string().optional(),
  }).default({ amount: null }),
  /** False when the notification states there is no age limit at all. */
  hasAgeLimit: z.boolean().default(true),
  ageRules: z.array(AgeRuleSchema).default([]),
  qualifications: z.array(QualificationRuleSchema).default([]),
  specialRequirements: z.array(SpecialRequirementSchema).default([]),
  selectionProcess: z.array(z.string()).default([]),
  officialLinks: z.object({
    notification: HttpUrl,
    apply: HttpUrl.nullable().default(null),
    board: HttpUrl,
    syllabus: HttpUrl.nullable().default(null),
  }),
  sources: z.array(SourceSchema).default([]),
  /** ISO timestamp of the last successful verification against sources. */
  verifiedAt: z.string().optional(),
  /** How the record is maintained. */
  maintenance: z.enum(['verified', 'monitored', 'announced']).default('verified'),
  editorialNote: z.string().optional(),
}).refine((e) => e.maintenance !== 'verified' || e.ageRules.length > 0 || e.hasAgeLimit === false, {
  message: 'A "verified" exam must carry at least one verified age rule',
  path: ['ageRules'],
});
export type Exam = z.infer<typeof ExamSchema>;

/** ------------------------------------------------------------------ */
/** Live feed / change log                                              */
/** ------------------------------------------------------------------ */

export const DocSchema = z.object({
  id: z.string(),
  category: z.string(),
  title: z.string(),
  url: z.string().nullable(),
  uploadedAt: z.string().nullable(),
  firstSeenAt: z.string(),
  sha256: z.string().optional(),
});
export type Doc = z.infer<typeof DocSchema>;

export const ExamFeedSchema = z.object({
  examId: z.string(),
  sourceExamId: z.string(),
  title: z.string(),
  docs: z.array(DocSchema),
  examDateRaw: z.string().nullable().default(null),
  applyRaw: z.string().nullable().default(null),
  fetchedAt: z.string(),
  sourceUrl: z.string().url(),
});
export type ExamFeed = z.infer<typeof ExamFeedSchema>;

export const CHANGE_KINDS = [
  'exam_date_changed',
  'application_window_changed',
  'new_addendum',
  'new_press_release',
  'vacancies_revised',
  'rule_changed',
  'result_published',
  'hall_ticket',
  'answer_key',
  'new_notification',
  'doc_published',
  'doc_removed',
] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

export const ChangeEventSchema = z.object({
  id: z.string(),
  examId: z.string(),
  examName: z.string(),
  kind: z.enum(CHANGE_KINDS),
  /** When the change became public, if the source states it. */
  effectiveAt: z.string().nullable().default(null),
  /** When ExamLens detected it. */
  detectedAt: z.string(),
  field: z.string().nullable().default(null),
  before: z.string().nullable().default(null),
  after: z.string().nullable().default(null),
  summary: z.string(),
  sourceUrl: z.string(),
  sourceTitle: z.string(),
  evidence: z.string().nullable().default(null),
  confidence: z.enum(['official', 'parsed', 'inferred']).default('official'),
  citationPage: z.number().int().optional(),
});
export type ChangeEvent = z.infer<typeof ChangeEventSchema>;

export const FreshnessSchema = z.object({
  generatedAt: z.string(),
  sources: z.array(z.object({
    id: z.string(),
    name: z.string(),
    url: z.string(),
    checkedAt: z.string(),
    httpStatus: z.number().nullable(),
    ok: z.boolean(),
    contentHash: z.string().nullable(),
    changed: z.boolean(),
    error: z.string().nullable(),
    consecutiveFailures: z.number().int().default(0),
  })),
  exams: z.array(z.object({
    examId: z.string(),
    verifiedAt: z.string().nullable(),
    ageHours: z.number().nullable(),
    staleness: z.enum(['fresh', 'aging', 'stale', 'unknown']),
    sourceOk: z.boolean(),
  })),
});
export type Freshness = z.infer<typeof FreshnessSchema>;

export const ProfileSchema = z.object({
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.enum(CATEGORIES),
  gender: z.enum(GENDERS).default('other'),
  qualification: z.enum(QUALIFICATION_LEVELS),
  /** Persons with benchmark disability. */
  pwd: z.boolean().default(false),
  exServicemen: z.boolean().default(false),
  destituteWidow: z.boolean().default(false),
  /** Currently a serving teacher in a Tamil Nadu school (TET-style tests). */
  servingTeacher: z.boolean().default(false),
  /** Studied in Tamil medium (reservation, not eligibility). */
  pstm: z.boolean().default(false),
  tamilMedium: z.boolean().default(false),
  /** True only when the candidate has passed SSLC with Tamil as a subject. */
  tamilSslc: z.boolean().default(false),
});
export type Profile = z.infer<typeof ProfileSchema>;
