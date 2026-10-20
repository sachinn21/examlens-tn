import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Set SITE_URL in CI (e.g. https://examlens.pages.dev) so canonical URLs and
// the sitemap are absolute. The fallback keeps local builds working.
// SITE_URL is set in CI; the deployed default keeps canonical URLs correct
// even when a build runs without it.
const site = process.env.SITE_URL ?? 'https://examlens-tn.netlify.app';

export default defineConfig({
  site,
  output: 'static',
  trailingSlash: 'never',
  integrations: [sitemap({ filter: (page) => !page.includes('/api/') })],
  build: {
    inlineStylesheets: 'auto',
    format: 'file',
  },
  compressHTML: true,
  devToolbar: { enabled: false },
});
