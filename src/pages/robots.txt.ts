import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
  const base = (site ?? new URL('https://examlens.pages.dev')).toString().replace(/\/$/, '');
  const body = [
    '# ExamLens mirrors public government recruitment notices for public-interest use.',
    '# Every page links to the official source. Crawling is welcome, including AI crawlers.',
    'User-agent: *',
    'Allow: /',
    '',
    'User-agent: GPTBot',
    'Allow: /',
    '',
    'User-agent: ClaudeBot',
    'Allow: /',
    '',
    'User-agent: PerplexityBot',
    'Allow: /',
    '',
    'User-agent: Google-Extended',
    'Allow: /',
    '',
    `Sitemap: ${base}/sitemap-index.xml`,
    `# llms.txt: ${base}/llms.txt`,
  ].join('\n');
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
};
