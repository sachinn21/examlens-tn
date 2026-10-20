import type { SiteExam } from './data';
import { getDataset } from './data';

export const SCHEMA_VERSION = '1.0.0';
export const LICENSE =
  'Compilation © ExamLens contributors, licensed CC BY 4.0. Underlying notices and PDFs remain the copyright of the respective government authority.';

export interface PublicExam {
  id: string;
  slug: string;
  url: string;
  name: string;
  shortName: string;
  tamilName?: string;
  board: string;
  boardName: string;
  notificationNo: string;
  year: number;
  status: string;
  level: string;
  maintained: string;
  summary: string;
  whyItMatters: string;
  dates: SiteExam['dates'] & { applyEndDaysLeft: number | null };
  vacancies: SiteExam['vacancies'];
  fee: SiteExam['fee'];
  selectionProcess: string[];
  ageLimit: {
    hasAgeLimit: boolean;
    rules: SiteExam['ageRules'];
  };
  qualifications: SiteExam['qualifications'];
  specialRequirements: SiteExam['specialRequirements'];
  officialLinks: SiteExam['officialLinks'];
  verification: {
    verifiedAt: string | null;
    staleness: string;
    sourcesChecked: number;
    unresolvedCitations: number;
    lastLiveCheck: string | null;
  };
  sources: SiteExam['sources'];
  liveDocuments?: Array<{ category: string; title: string; url: string | null; publishedAt: string | null }>;
  editorialNote?: string;
}

export function publicExam(exam: SiteExam, site: URL): PublicExam {
  const base = site.toString().replace(/\/$/, '');
  return {
    id: exam.id,
    slug: exam.slug,
    url: `${base}/exams/${exam.slug}`,
    name: exam.name,
    shortName: exam.shortName,
    ...(exam.tamilName ? { tamilName: exam.tamilName } : {}),
    board: exam.board,
    boardName: exam.boardName,
    notificationNo: exam.notificationNo,
    year: exam.year,
    status: exam.status,
    level: exam.level,
    maintained: exam.maintenance,
    summary: exam.summary,
    whyItMatters: exam.whyItMatters,
    dates: { ...exam.dates, applyEndDaysLeft: exam.applyEndInDays },
    vacancies: exam.vacancies,
    fee: exam.fee,
    selectionProcess: exam.selectionProcess,
    ageLimit: { hasAgeLimit: exam.hasAgeLimit, rules: exam.ageRules },
    qualifications: exam.qualifications,
    specialRequirements: exam.specialRequirements,
    officialLinks: exam.officialLinks,
    verification: {
      verifiedAt: exam.freshness.verifiedAt,
      staleness: exam.freshness.staleness,
      sourcesChecked: exam.sources.length,
      unresolvedCitations: exam.citationIssues.length,
      lastLiveCheck: exam.live?.fetchedAt ?? null,
    },
    sources: exam.sources,
    ...(exam.live
      ? {
          liveDocuments: exam.live.docs.map((d) => ({
            category: d.category,
            title: d.title,
            url: d.url,
            publishedAt: d.uploadedAt,
          })),
        }
      : {}),
    ...(exam.editorialNote ? { editorialNote: exam.editorialNote } : {}),
  };
}

export function datasetMeta(site: URL) {
  const ds = getDataset();
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: ds.generatedAt,
    site: site.toString().replace(/\/$/, ''),
    license: LICENSE,
    counts: ds.counts,
    endpoints: {
      exams: '/api/v1/exams.json',
      exam: '/api/v1/exam/{id}.json',
      changes: '/api/v1/changes.json',
      changes7d: '/api/v1/changes-7d.json',
      meta: '/api/v1/meta.json',
      llms: '/llms.txt',
      llmsFull: '/llms-full.txt',
      rss: '/changes.xml',
      calendar: '/calendar.ics',
    },
    howEligibilityWorks: {
      description:
        'Each exam carries machine-readable age rules with an "as on" cutoff date. Age is completed years on the cutoff. A candidate is age-eligible when minAge <= age < maxAge for their category after applying the PwBD / ex-servicemen / destitute-widow concession that applies to them.',
      fields: ['dob (YYYY-MM-DD)', 'category', 'gender', 'qualification', 'pwd', 'exServicemen', 'destituteWidow', 'servingTeacher', 'tamilSslc'],
      categories: ['general', 'bc', 'bcm', 'mbc_dc', 'sc', 'sca', 'st'],
      qualifications: ['none', 'sslc', 'hsc', 'iti', 'diploma', 'degree', 'pg'],
    },
  };
}

export function jsonResponse(data: unknown, maxAge = 3600): Response {
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${maxAge}, s-maxage=${maxAge}`,
      'access-control-allow-origin': '*',
      'x-schema-version': SCHEMA_VERSION,
    },
  });
}
