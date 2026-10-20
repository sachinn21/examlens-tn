# Deploying ExamLens

Three things need to happen, in this order:

1. the site is served statically
2. a scheduled job refreshes `data/` and commits
3. the host rebuilds on that commit

Everything below is free.

---

## 1. Cloudflare Pages (recommended)

Unlimited static requests, global CDN, GitHub integration with no config file.

1. Push the repo to GitHub.
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
3. Pick the repo and use:

   | Setting | Value |
   |---|---|
   | Framework preset | Astro |
   | Build command | `pnpm build` |
   | Build output directory | `dist` |
   | Environment variable | `SITE_URL = https://<your-project>.pages.dev` |

4. Deploy. The first build is ~40 seconds.

`SITE_URL` matters: canonical URLs, the sitemap, RSS links and every absolute URL in the JSON API
are built from it. Set it before the first production build, or the site will point at the
placeholder domain.

### Custom domain

Pages → Custom domains → add `examlens.in` (or whatever you own). Then change `SITE_URL` to match
and redeploy so canonical URLs follow.

### Optional runtime eligibility endpoint

`functions/api/eligibility.ts` is a Cloudflare Pages Function. If the `functions/` directory is
present at the repository root, Pages compiles it automatically:

```
GET  /api/eligibility?dob=1998-05-12&category=bc&qualification=degree
POST /api/eligibility   {"dob":"1998-05-12","category":"bc","qualification":"degree"}
```

It reads the same published dataset and runs the same engine as the browser, so the two cannot
disagree. Static hosting alone is enough for the site and for agents that compute the verdict
themselves; delete the folder if you do not want the endpoint.

### Headers and caching

`public/_headers` ships security headers and a one-year immutable cache for `/_astro/*`. JSON and
feed endpoints set their own `Cache-Control` in code.

---

## 2. The scheduled refresh

`.github/workflows/refresh.yml` runs at `17 */6 * * *` UTC (six times a day, deliberately off the
hour). It:

1. re-reads the TNPSC dashboard and every cited PDF
2. re-verifies every quotation
3. runs the validator and unit tests
4. builds the site (so a broken build never reaches production)
5. commits `data/` **only if something changed**
6. opens a `data-refresh` issue on failure

Requirements:

- Repo → Settings → Actions → General → **Workflow permissions: Read and write**.
- Repo → Settings → Variables → add `SITE_URL` (same value as Pages).
- Keep the repo public for unlimited Actions minutes. A run takes ~90 s.

The commit triggers the Pages build automatically. Change log entries are written before the site
builds, so the site and the log never disagree.

### How often should it run?

Every six hours is a compromise: government boards update a handful of times per week, and each
run downloads only documents whose ETag changed. Hourly is safe if you want it — the pipeline is
idempotent and the dashboard fetch is one request.

### If Actions are unavailable

The pipeline is a plain script; anything that can run `pnpm refresh` works:

```bash
# any cron host, any container
pnpm install --frozen-lockfile && pnpm refresh && pnpm validate
git add data && git commit -m "data: refresh $(date -u +%FT%TZ)" && git push
```

For Cloudflare-native cron you would move `scripts/refresh.ts` into a Worker with a Cron Trigger,
store `data/state` in KV, and rebuild Pages with a deploy hook. That is a real option but it
duplicates the pipeline, so this repo stays with the simplest arrangement that works for free.

---

## 3. Alternatives

### GitHub Pages

Works if the site is served from a domain root. For a project site (`user.github.io/repo`) you must
set `base: '/repo'` in `astro.config.mjs` and rebuild; canonical URLs then include the prefix.
Cloudflare Pages avoids this entirely, which is why it is the recommended path.

### Netlify / Vercel

Identical shape: build `pnpm build`, publish `dist`, set `SITE_URL`. Both free tiers are fine at
this traffic level.

### Self-hosted

`dist/` is a folder of static files. Any nginx/Caddy bucket will do. The refresh job still needs to
run somewhere with network access and a way to push the commit.

---

## Post-launch checklist

- [ ] `SITE_URL` set and the deployed HTML shows the right canonical domain
- [ ] `/api/v1/exams.json` returns 200 with `schemaVersion`
- [ ] `/llms.txt` and `/llms-full.txt` are plain text, not HTML
- [ ] `/changes.xml` parses (paste into an RSS reader)
- [ ] `/calendar.ics` subscribes in Google Calendar
- [ ] `sitemap-index.xml` submitted in Google Search Console
- [ ] The refresh workflow has run once and committed a `data:` commit
- [ ] One deliberate failure tested: rename a quote in a curated file, run `pnpm validate`, confirm it fails

The last one matters. The entire trust proposition rests on the gate actually firing.

---

## Cost

| Item | Free tier | This project |
|---|---|---|
| Cloudflare Pages | unlimited requests, 500 builds/month | 4 builds/day = 120/month |
| GitHub Actions | 2,000 min/month private, unlimited public | ~90 s × 4/day ≈ 180 min/month |
| Storage | — | dataset under 1 MB |
| Database | — | none |

Total: ₹0. The only recurring cost is your time when a notification is re-issued.
