import type { APIRoute } from 'astro';
import { getDataset } from '../../lib/server/data';
import { liveStatus, primaryAgeRule } from '../../lib/presentation';

/**
 * CSV cell. Values beginning with = + - @ are prefixed with an apostrophe so a
 * spreadsheet does not execute an official document's title as a formula.
 */
const q = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const GET: APIRoute = ({ site }) => {
  const base = (site ?? new URL('https://examlens.pages.dev')).toString().replace(/\/$/, '');
  const ds = getDataset();
  const header = [
    'id', 'name', 'board', 'notification_no', 'year', 'status', 'maintenance',
    'rule_id', 'rule_label', 'post_codes', 'cutoff_date', 'min_age',
    'max_age_general', 'max_age_bc', 'max_age_mbc', 'max_age_sc', 'max_age_st',
    'pwd_limit_general', 'exsm_limit_general', 'widow_limit_general',
    'apply_start', 'apply_end', 'exam_date',
    'vacancies', 'notification_url', 'page_url', 'verified_at', 'unresolved_citations',
  ];
  const rows = ds.exams.flatMap((e) => {
    const baseRow = [
      e.id, e.name, e.board, e.notificationNo, e.year, liveStatus(e), e.maintenance,
    ];
    const tail = [
      e.dates.applyStart ?? '', e.dates.applyEnd ?? '', e.dates.examDate ?? '',
      e.vacancies.total ?? '', e.officialLinks.notification, `${base}/exams/${e.slug}`,
      e.freshness.verifiedAt ?? '', e.citationIssues.length,
    ];
    if (!e.ageRules.length) {
      return [[...baseRow, '', e.hasAgeLimit === false ? 'no age limit prescribed' : 'rules not verified',
        '', e.dates.cutoffAgeDate ?? '', '', '', '', '', '', '', '', '', ...tail].map(q).join(',')];
    }
    return e.ageRules.map((r) => [
      ...baseRow, r.id, r.label, r.appliesTo.postCodes.join(' '),
      r.cutoff, r.minAge,
      r.maxAge?.general ?? '', r.maxAge?.bc ?? '', r.maxAge?.mbc_dc ?? '', r.maxAge?.sc ?? '', r.maxAge?.st ?? '',
      r.concessions.pwd?.value ?? '', r.concessions.exServicemen?.value ?? '', r.concessions.destituteWidow?.value ?? '',
      ...tail,
    ].map(q).join(','));
  });
  const csv = '\uFEFF' + [header.join(','), ...rows].join('\n');
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'inline; filename="examlens-tn-exams.csv"',
      'cache-control': 'public, max-age=3600',
    },
  });
};
