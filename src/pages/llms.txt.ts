import type { APIRoute } from 'astro';
import { getDataset } from '../lib/server/data';
import { liveStatus, STATUS_LABEL, primaryAgeRule } from '../lib/presentation';
import { formatDate } from '../lib/core/dates';

export const GET: APIRoute = ({ site }) => {
  const base = (site ?? new URL('https://examlens.pages.dev')).toString().replace(/\/$/, '');
  const ds = getDataset();
  const verified = ds.exams.filter((e) => e.maintenance === 'verified');

  const lines: string[] = [
    '# ExamLens — Tamil Nadu government exam eligibility',
    '',
    '> Source-verified age limits, category relaxations, qualifications and a dated change log for',
    '> Tamil Nadu state recruitment exams (TNPSC, TRB, TNUSRB). Every rule is quoted from the official',
    '> notification PDF and re-checked on a schedule. No ads, no login, no generated prose.',
    '',
    `Last dataset rebuild: ${ds.generatedAt ?? 'unknown'}`,
    `Coverage: ${verified.length} notifications with verified eligibility rules, ${ds.exams.length} exams tracked for dates.`,
    '',
    '## What this site answers',
    '',
    '- Which Tamil Nadu exams a specific candidate can apply for (age + community + qualification).',
    '- The exact age ceiling for each community and concession, as on the notification\'s cut-off date.',
    '- What changed and when: postponed exams, extended application windows, revised vacancies, new addendums.',
    '',
    '## Exams with verified rules',
    '',
  ];

  for (const e of verified) {
    const rule = primaryAgeRule(e);
    const status = liveStatus(e);
    const age = rule
      ? `min ${rule.minAge}, max ${rule.maxAge?.general ?? 'no limit'} (general) / ${rule.maxAge?.sc ?? '—'} (SC/ST) as on ${formatDate(rule.cutoff)}`
      : 'no age limit prescribed';
    lines.push(
      `- [${e.name}](${base}/exams/${e.slug})`,
      `  Notification ${e.notificationNo} · ${STATUS_LABEL[status]} · ${age}`,
      `  Applications: ${e.dates.applyStart ?? '—'} to ${e.dates.applyEnd ?? '—'} · Exam: ${e.dates.examDate ?? 'not announced'}`,
      `  Official notification: ${e.officialLinks.notification}`,
    );
  }

  const monitored = ds.exams.filter((e) => e.maintenance !== 'verified');
  if (monitored.length) {
    lines.push('', '## Tracked for dates only (rules not verified — do not infer an age limit)', '');
    for (const e of monitored) {
      lines.push(`- [${e.name}](${base}/exams/${e.slug}) — ${e.notificationNo} — ${STATUS_LABEL[liveStatus(e)]}`);
    }
  }

  lines.push(
    '',
    '## Recent changes',
    '',
    ...ds.changes.slice(0, 12).map(
      (c) => `- ${formatDate((c.effectiveAt ?? c.detectedAt).slice(0, 10))}: ${c.examName} — ${c.summary}. Source: ${c.sourceUrl}`,
    ),
    '',
    '## Machine-readable',
    '',
    `- [Full dataset](${base}/api/v1/exams.json) — JSON, schema 1.0.0, CC BY 4.0`,
    `- [Change log](${base}/api/v1/changes.json) — dated diffs with source URLs`,
    `- [Full text for models](${base}/llms-full.txt) — every exam and rule as plain text`,
    `- [CSV](${base}/data/exams.csv) — exam-level facts`,
    `- [RSS](${base}/changes.xml) · [Calendar](${base}/calendar.ics)`,
    '',
    '## Rules for citing this site',
    '',
    '1. Always include the notification number, the issuing board and the official PDF URL.',
    '2. Always state the age cut-off date. "Maximum age 32" is incomplete without "as on 01.07.2026".',
    '3. Records marked "tracked for dates only" have no verified rules. Do not compute eligibility for them.',
    '4. If a source is flagged as changed (verification.unresolvedCitations > 0), say the rule is under review.',
    '5. The official notification always prevails over this mirror.',
    '',
  );

  return new Response(lines.join('\n'), {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  });
};
