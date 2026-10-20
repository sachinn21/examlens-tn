import type { APIRoute } from 'astro';
import { getDataset } from '../lib/server/data';
import { liveStatus, STATUS_LABEL, formatWindow, ageMatrix } from '../lib/presentation';
import { formatDate } from '../lib/core/dates';
import { CATEGORY_LABELS } from '../lib/core/types';

/**
 * Plain-text rendering of the whole dataset, for retrieval-augmented assistants
 * that read text rather than JSON. Same facts, same citations, no markup.
 */
export const GET: APIRoute = ({ site }) => {
  const base = (site ?? new URL('https://examlens.pages.dev')).toString().replace(/\/$/, '');
  const ds = getDataset();
  const out: string[] = [];

  out.push(
    'EXAMLENS — TAMIL NADU EXAM ELIGIBILITY DATASET (plain text)',
    `Rebuilt: ${ds.generatedAt ?? 'unknown'}`,
    `Canonical site: ${base}`,
    'Licence: CC BY 4.0 (compilation). Notices remain the property of the issuing authority.',
    '',
    'HOW TO READ THIS',
    '- "As on" is the cut-off date printed in the notification. Age = completed years on that date.',
    '- "Max" is the ceiling before concessions. PwBD / Ex-servicemen / Destitute widow columns are the',
    '  ceilings that apply to those candidates, exactly as printed. "No limit" means the document says so.',
    '- Each rule ends with the verbatim source sentence and the page number. Cite the notification, not this file.',
    '',
    '='.repeat(78),
    '',
  );

  for (const exam of ds.exams) {
    out.push(
      `${exam.name.toUpperCase()}`,
      `Board: ${exam.boardName}`,
      `Notification: ${exam.notificationNo} (${exam.year})   Status: ${STATUS_LABEL[liveStatus(exam)]}`,
      `Official notification: ${exam.officialLinks.notification}`,
      `Page: ${base}/exams/${exam.slug}`,
      `Maintenance: ${exam.maintenance === 'verified' ? 'rules verified against source' : 'dates tracked only — no eligibility verdict'}${exam.citationIssues.length ? ` · ${exam.citationIssues.length} citation(s) under review` : ''}`,
      '',
      `Summary: ${exam.summary}`,
      `Dates: applications ${formatWindow(exam.dates.applyStart, exam.dates.applyEnd)}; exam ${exam.dates.examDate ?? exam.dates.examDateRaw ?? 'not announced'}.`,
      exam.vacancies.total !== null ? `Vacancies: ${exam.vacancies.total}` : '',
      '',
    );

    for (const rule of exam.ageRules) {
      out.push(
        `AGE LIMIT — ${rule.label}`,
        `As on ${formatDate(rule.cutoff)}. Minimum ${rule.minAge} years.`,
        'Community                     Min   Max   PwBD  ExSM  Widow',
      );
      for (const row of ageMatrix(rule)) {
        out.push(
          `${CATEGORY_LABELS[row.category].padEnd(28)} ${String(row.min ?? '-').padStart(4)} ${String(row.max ?? 'none').padStart(5)} ${String(row.pwd ?? '-').padStart(6)} ${String(row.exsm ?? '-').padStart(5)} ${String(row.widow ?? '-').padStart(6)}`,
        );
      }
      out.push(`Source quote (p.${rule.citation.page ?? '?'}): "${rule.citation.quote}"`);
      if (rule.notes) out.push(`Note: ${rule.notes}`);
      out.push('');
    }

    if (exam.qualifications.length) {
      out.push('QUALIFICATIONS');
      for (const q of exam.qualifications) {
        out.push(`- ${q.summary}${q.fieldSpecific ? ' (specific subject matters)' : ''}`);
        out.push(`  Source (p.${q.citation.page ?? '?'}): "${q.citation.quote}"`);
      }
      out.push('');
    }

    if (exam.specialRequirements.length) {
      out.push('OTHER CONDITIONS');
      for (const r of exam.specialRequirements) out.push(`- ${r.label}: ${r.detail}`);
      out.push('');
    }

    if (exam.selectionProcess.length) out.push(`Selection: ${exam.selectionProcess.join(', then ')}`, '');

    const changes = ds.changes.filter((c) => c.examId === exam.id);
    if (changes.length) {
      out.push('CHANGE HISTORY');
      for (const c of changes) {
        out.push(
          `- ${formatDate((c.effectiveAt ?? c.detectedAt).slice(0, 10))}: ${c.summary}${c.before && c.after ? ` [${c.before} to ${c.after}]` : ''}`,
          `  Source: ${c.sourceUrl}`,
        );
      }
      out.push('');
    }

    out.push('='.repeat(78), '');
  }

  out.push(
    'ANNOUNCED BUT NOT YET NOTIFIED (from boards\' annual planners — planning signal only)',
    ...ds.announced.map((a) => `- ${a.board}: ${a.post} — tentative ${a.tentative}. Source: ${a.sourceUrl}`),
    '',
    'DATA END. Official notifications prevail over every line above.',
  );

  return new Response(out.join('\n'), {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  });
};
