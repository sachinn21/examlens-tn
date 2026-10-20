import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Set SITE_URL in CI (e.g. https://examlens.pages.dev) so canonical URLs and
// the sitemap are absolute. The fallback keeps local builds working.
const site = process.env.SITE_URL ?? 'https://examlens.pages.dev';

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
