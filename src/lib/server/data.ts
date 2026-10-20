import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ExamSchema,
  type ChangeEvent,
  type Citation,
  type Exam,
  type ExamFeed,
  type Freshness,
} from '../core/types';
import type { CitationReport } from '../ingest/verify';
import { daysUntil, parseNotificationDate } from '../core/dates';
import { normalizeNotificationNo, trackedExamId } from '../core/constants';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const DATA = join(ROOT, 'data');
const STATE = join(DATA, 'state');

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch (err) {
    // A truncated state file must fail the build rather than quietly serving
    // an empty dataset with no change log and no verification banners.
    throw new Error(`Corrupt state file ${path}: ${(err as Error).message}. Re-run \`pnpm refresh\`.`);
  }
}

export interface AnnouncedExam {
  id: string;
  board: string;
  post: string;
  tentative: string;
  sourceUrl: string;
  sourceTitle: string;
  quote: string;
  page?: number;
}

export interface SiteExam extends Exam {
  live: ExamFeed | null;
  freshness: {
    staleness: 'fresh' | 'aging' | 'stale' | 'unknown';
    verifiedAt: string | null;
    ageHours: number | null;
  };
  citationIssues: CitationReport['issues'];
  applyEndInDays: number | null;
  examInDays: number | null;
  trackedOnly: boolean;
}

export interface Dataset {
  exams: SiteExam[];
  changes: ChangeEvent[];
  freshness: Freshness | null;
  citations: CitationReport[];
  announced: AnnouncedExam[];
  generatedAt: string | null;
  counts: {
    exams: number;
    verifiedExams: number;
    sources: number;
    changes: number;
    last24h: number;
  };
}

function loadCurated(): Exam[] {
  const dir = join(DATA, 'curated', 'exams');
  if (!existsSync(dir)) return [];
  const out: Exam[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const parsed = ExamSchema.safeParse(JSON.parse(readFileSync(join(dir, file), 'utf8')));
    if (parsed.success) out.push(parsed.data);
    else console.warn(`[data] skipping invalid ${file}: ${parsed.error.issues[0]?.message}`);
  }
  return out;
}

/** Live dashboard feeds that no curated record claims become date-tracked cards. */
function trackedFromFeeds(feeds: ExamFeed[], curated: Exam[]): Exam[] {
  // Only TNPSC records can claim a TNPSC dashboard card — TRB also issues a "01/2026".
  const claimed = new Set(
    curated.filter((e) => e.board === 'tnpsc').map((e) => normalizeNotificationNo(e.notificationNo)).filter(Boolean),
  );
  const out: Exam[] = [];
  for (const feed of feeds) {
    const notif = feed.title.match(/(\d{1,3})\s*\/\s*(\d{4})\s*$/);
    const notificationNo = normalizeNotificationNo(notif ? `${notif[1]}/${notif[2]}` : null);
    if (!notificationNo || claimed.has(notificationNo)) continue;
    const name = notif ? feed.title.slice(0, notif.index).replace(/[-–\s]+$/, '').trim() : feed.title;
    const year = Number(notif?.[2] ?? new Date().getFullYear());
    // Archived cycles get one clean URL each; the name lives in the page.
    if (year < new Date().getFullYear()) continue;

    const text = `${feed.applyRaw ?? ''} ${feed.examDateRaw ?? ''}`;
    const startMatch = text.match(/commencement[^:]*:\s*([\d]{1,2}[./-][\d]{1,2}[./-][\d]{4})/i);
    const endMatch = text.match(/last date[^:]*:\s*([\d]{1,2}[./-][\d]{1,2}[./-][\d]{4})/i);
    const examMatch = (feed.examDateRaw ?? '').match(/([\d]{1,2}[./-][\d]{1,2}[./-][\d]{4})/);
    const applyStart = parseNotificationDate(startMatch?.[1] ?? null);
    const applyEnd = parseNotificationDate(endMatch?.[1] ?? null);
    const examDate = parseNotificationDate(examMatch?.[1] ?? null);
    const slug = trackedExamId(notificationNo)!;
    out.push({
      id: trackedExamId(notificationNo)!,
      board: 'tnpsc',
      boardName: 'Tamil Nadu Public Service Commission',
      name,
      shortName: name.replace(/\(.*?\)/g, '').trim().slice(0, 60),
      notificationNo,
      slug,
      year,
      status: 'open',
      level: 'other',
      summary: 'Dates and published documents are tracked live from the TNPSC exam dashboard. Eligibility rules for this notification have not been individually verified yet.',
      whyItMatters: 'Registration and exam dates are mirrored directly from the Commission’s dashboard, including every addendum.',
      dates: {
        notification: null,
        applyStart,
        applyEnd,
        examDate,
        examDateRaw: feed.examDateRaw ?? undefined,
        resultDate: null,
        cutoffAgeDate: null,
      },
      vacancies: { total: null, breakdown: [] },
      fee: { amount: null },
      hasAgeLimit: true,
      ageRules: [],
      qualifications: [],
      specialRequirements: [],
      selectionProcess: [],
      officialLinks: {
        notification: feed.sourceUrl,
        apply: 'https://apply.tnpscexams.in/secure?app_id=UElZMDAwMDAwMQ==',
        board: 'https://tnpsc.gov.in/',
        syllabus: null,
      },
      sources: [],
      maintenance: 'monitored',
      editorialNote: 'Auto-imported from the TNPSC dashboard. Age and qualification rules are not yet verified for this notification, so ExamLens does not give an eligibility verdict.',
    });
  }
  return out;
}

function loadAnnounced(): AnnouncedExam[] {
  return [
    {
      id: 'tnusrb-pc-women-2026',
      board: 'TNUSRB',
      post: 'Grade-II Police Constables (Women)',
      tentative: 'December 2026',
      sourceUrl: 'https://tnusrb.tn.gov.in/pdfs/Annual_Planner_2026_English.pdf',
      sourceTitle: 'TNUSRB Annual Planner 2026–2027',
      quote: 'Direct recruitment to the post of Grade-II Police Constables (Women)',
      page: 1,
    },
    {
      id: 'tnusrb-si-women-2026',
      board: 'TNUSRB',
      post: 'Sub-Inspectors of Police (Women) – Taluk',
      tentative: 'December 2026',
      sourceUrl: 'https://tnusrb.tn.gov.in/pdfs/Annual_Planner_2026_English.pdf',
      sourceTitle: 'TNUSRB Annual Planner 2026–2027',
      quote: 'Direct recruitment to the post of Sub-Inspectors of Police (Women) - Taluk',
      page: 1,
    },
    {
      id: 'tnusrb-common-2027',
      board: 'TNUSRB',
      post: 'Common Recruitment (Police Constable, Fireman, Jail Warder)',
      tentative: 'February 2027',
      sourceUrl: 'https://tnusrb.tn.gov.in/pdfs/Annual_Planner_2026_English.pdf',
      sourceTitle: 'TNUSRB Annual Planner 2026–2027',
      quote: 'Common Recruitment',
      page: 1,
    },
    {
      id: 'tnusrb-si-technical-2027',
      board: 'TNUSRB',
      post: 'Sub-Inspectors (Technical)',
      tentative: 'February 2027',
      sourceUrl: 'https://tnusrb.tn.gov.in/pdfs/Annual_Planner_2026_English.pdf',
      sourceTitle: 'TNUSRB Annual Planner 2026–2027',
      quote: 'Direct recruitment to the post of Sub-Inspectors (Technical)',
      page: 1,
    },
    {
      id: 'tnusrb-band-2027',
      board: 'TNUSRB',
      post: 'Band Police Constables',
      tentative: 'March 2027',
      sourceUrl: 'https://tnusrb.tn.gov.in/pdfs/Annual_Planner_2026_English.pdf',
      sourceTitle: 'TNUSRB Annual Planner 2026–2027',
      quote: 'Direct recruitment to the post of Band Police Constables',
      page: 1,
    },
    {
      id: 'tnusrb-si-2027',
      board: 'TNUSRB',
      post: 'Sub-Inspectors of Police',
      tentative: 'June 2027',
      sourceUrl: 'https://tnusrb.tn.gov.in/pdfs/Annual_Planner_2026_English.pdf',
      sourceTitle: 'TNUSRB Annual Planner 2026–2027',
      quote: 'Direct recruitment to the post of Sub-Inspectors of Police',
      page: 1,
    },
  ];
}

let cache: Dataset | null = null;

export function getDataset(): Dataset {
  if (cache) return cache;

  const curated = loadCurated();
  const snapshot = readJson<{ exams: Record<string, ExamFeed> }>(join(STATE, 'snapshot.json'), { exams: {} });
  const feeds = Object.values(snapshot.exams ?? {});
  const tracked = trackedFromFeeds(feeds, curated);
  const changelog = readJson<{ events: ChangeEvent[] }>(join(STATE, 'changelog.json'), { events: [] });
  const freshness = readJson<Freshness | null>(join(STATE, 'freshness.json'), null);
  const citationFile = readJson<{ reports: CitationReport[]; generatedAt: string }>(join(STATE, 'citations.json'), {
    reports: [],
    generatedAt: '',
  });

  const feedByNotif = new Map<string, ExamFeed>();
  for (const f of feeds) {
    const m = f.title.match(/(\d{1,3})\s*\/\s*(\d{4})\s*$/);
    const n = normalizeNotificationNo(m ? `${m[1]}/${m[2]}` : null);
    if (n) feedByNotif.set(n, f);
  }
  const freshById = new Map((freshness?.exams ?? []).map((e) => [e.examId, e]));
  const reportById = new Map(citationFile.reports.map((r) => [r.examId, r]));

  const seenIds = new Set<string>();
  const all = [...curated, ...tracked].filter((e) => {
    if (seenIds.has(e.id)) return false;
    seenIds.add(e.id);
    return true;
  });
  const now = new Date();
  const exams: SiteExam[] = all.map((exam) => {
    const live = feedByNotif.get(normalizeNotificationNo(exam.notificationNo) ?? '') ?? null;
    const f = freshById.get(exam.id);
    return {
      ...exam,
      live,
      freshness: {
        staleness: f?.staleness ?? (exam.maintenance === 'monitored' ? 'fresh' : 'unknown'),
        verifiedAt: f?.verifiedAt ?? exam.verifiedAt ?? live?.fetchedAt ?? null,
        ageHours: f?.ageHours ?? null,
      },
      citationIssues: reportById.get(exam.id)?.issues ?? [],
      applyEndInDays: daysUntil(exam.dates.applyEnd, now),
      examInDays: daysUntil(exam.dates.examDate, now),
      trackedOnly: exam.maintenance !== 'verified',
    };
  });

  exams.sort((a, b) => {
    const rank = (e: SiteExam) => (e.maintenance === 'verified' ? 0 : 1);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return (a.dates.applyEnd ?? '9999').localeCompare(b.dates.applyEnd ?? '9999');
  });

  const byId = new Map(exams.map((e) => [e.id, e]));
  // Only changes belonging to an examination we actually publish: a log entry
  // that links to a page which does not exist is worse than no entry.
  const changes = changelog.events
    .filter((c) => byId.has(c.examId))
    .map((c) => ({ ...c, examName: byId.get(c.examId)!.shortName }));

  const last24h = changes.filter(
    (e) => Date.parse(e.detectedAt) > now.getTime() - 24 * 3_600_000,
  ).length;

  cache = {
    exams,
    changes,
    freshness,
    citations: citationFile.reports,
    announced: loadAnnounced(),
    generatedAt: freshness?.generatedAt ?? citationFile.generatedAt ?? null,
    counts: {
      exams: exams.length,
      verifiedExams: exams.filter((e) => e.maintenance === 'verified').length,
      sources: freshness?.sources.length ?? 0,
      changes: changes.length,
      last24h,
    },
  };
  return cache;
}

export function citationFor(exam: SiteExam, citation: Citation) {
  return {
    ...citation,
    url: exam.officialLinks.notification,
  };
}

export function examBySlug(slug: string): SiteExam | undefined {
  return getDataset().exams.find((e) => e.slug === slug);
}
