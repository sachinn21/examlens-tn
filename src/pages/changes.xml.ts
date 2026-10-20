import type { APIRoute } from 'astro';
import { getDataset } from '../lib/server/data';
import { xmlEscape } from '../lib/presentation';

export const GET: APIRoute = ({ site }) => {
  const base = (site ?? new URL('https://examlens.pages.dev')).toString().replace(/\/$/, '');
  const ds = getDataset();
  const items = ds.changes.slice(0, 50).map((c) => {
    const link = c.sourceUrl;
    const date = new Date(c.effectiveAt ?? c.detectedAt).toUTCString();
    return [
      '    <item>',
      `      <title>${xmlEscape(`${c.examName}: ${c.summary}`)}</title>`,
      `      <link>${xmlEscape(link)}</link>`,
      `      <guid isPermaLink="false">${xmlEscape(c.id)}</guid>`,
      `      <pubDate>${date}</pubDate>`,
      `      <category>${xmlEscape(c.kind)}</category>`,
      `      <description>${xmlEscape(
        [
          c.summary,
          c.before && c.after ? `Before: ${c.before}. After: ${c.after}` : '',
          c.evidence ? `Source text: “${c.evidence}”` : '',
          `Official document: ${c.sourceUrl}`,
          `Exam page: ${base}/exams/${c.examId}`,
        ]
          .filter(Boolean)
          .join('\n'),
      )}</description>`,
      '    </item>',
    ].join('\n');
  });

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    '    <title>ExamLens — Tamil Nadu exam changes</title>',
    `    <link>${base}/changes</link>`,
    '    <description>Dated, sourced changes to Tamil Nadu government recruitment exams.</description>',
    '    <language>en-in</language>',
    `    <lastBuildDate>${new Date(ds.generatedAt ?? Date.now()).toUTCString()}</lastBuildDate>`,
    `    <atom:link href="${base}/changes.xml" rel="self" type="application/rss+xml" />`,
    ...items,
    '  </channel>',
    '</rss>',
  ].join('\n');

  return new Response(xml, {
    headers: { 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'public, max-age=1800' },
  });
};
