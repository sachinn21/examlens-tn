# ExamLens — Tamil Nadu exam eligibility, verified

A source-first answer to *"which Tamil Nadu government exams can I actually sit for?"* — plus a
dated change log of every date the government has moved.

**Live:** https://examlens-tn.netlify.app · **Refresh:** twice daily from a machine that can reach
the boards (see [docs/HOSTING.md](docs/HOSTING.md) for why not GitHub Actions).

**Live dataset:** 7 notifications with individually verified age/qualification rules, 20 exam
cycles mirrored from the TNPSC dashboard, and every change since tracking began. No LLM calls at
runtime, no paid APIs, no database. It builds to static HTML and JSON, so it can be hosted free.

---

## What this is

A public record of Tamil Nadu government examination conditions, with two guarantees:

1. **Every rule is quoted.** An age limit, a qualification clause or a fee is stored with a
   verbatim sentence from the official notification and the page it appears on. The refresh
   pipeline downloads the document again and searches for that sentence. If it is missing, the
   examination is flagged, the eligibility answer is withheld, and CI fails until a human
   reviews it.
2. **Every change is dated.** The pipeline keeps the previous document list and date lines for
   each examination. New addendums, moved examination dates and revised vacancy counts become
   entries in a change log with the source document and, where the document states it, the
   sentence that announced the change.

There are no language-model calls at runtime and no paid APIs. The pipeline is ordinary code
against public government pages, and the site is static files.

## What is actually implemented

| Capability | Where |
|---|---|
| Age engine (cut-off date, community ceilings, PwBD / ex-servicemen / widow concessions) | `src/lib/core/eligibility.ts` |
| Verbatim citation checking, including table-value fingerprints | `src/lib/ingest/verify.ts` |
| Live TNPSC dashboard scraper (ASP.NET postback, 2026 + 2025) | `src/lib/ingest/sources/tnpsc.ts` |
| Change detection (new addendum, moved exam date, revised vacancies) | `src/lib/core/changelog.ts`, `scripts/refresh.ts` |
| Explicit date-change extraction ("postponed from X to Y") | `parseOfficialDateChange` |
| Static site, exam pages, eligibility wizard, change log, source health | `src/pages/` |
| JSON API, CSV, RSS, `.ics`, `llms.txt`, `llms-full.txt` | `src/pages/api`, `src/pages/*.ts` |
| Scheduled refresh + data commit | `.github/workflows/refresh.yml` |
| Data gate (schema, citations, staleness) | `scripts/validate-data.ts` |

## Quick start

```bash
pnpm install
pnpm refresh          # hits the live boards (~1 min, needs network)
pnpm validate         # fails if any citation no longer matches
pnpm test             # 41 unit tests on real notification values
pnpm build            # → dist/ (static, ~800 KB)
pnpm preview          # http://localhost:4321
```

`pnpm dev` for hot reload. If you are offline, `pnpm refresh:offline` re-runs verification against
the cached result and rebuilds the site without touching the network.

## Deploy in about five minutes

See [docs/DEPLOY.md](docs/DEPLOY.md). Short version: push this repo to GitHub, create a
Cloudflare Pages project pointed at it (`pnpm build`, output `dist`), set `SITE_URL`, done.
The refresh workflow starts committing data on its own schedule.

Free-tier reality: Cloudflare Pages allows unlimited static requests; GitHub Actions gives 2,000
minutes/month on private repos and unlimited on public ones. A refresh run takes about 90 seconds.

## Adding an exam (the actual work)

The bottleneck is data entry, not code. For a new notification:

1. Open the notification PDF and find para 4.1 (age) and 4.2 (qualification).
2. Copy `data/curated/exams/tnpsc-group-4-2026.json` to a new id and edit.
3. For every rule, paste a sentence **exactly** as printed, with its page number and the numbers
   from that table. Do not paraphrase — the validator searches for the string.
4. `pnpm refresh && pnpm validate`. If a quote does not match, the tool prints the page it
   searched and how much of the quote it found, so you can fix the transcription.
5. `pnpm test` and commit.

`pnpm new:exam <id>` writes a skeleton with the right shape.

## Data model in one minute

```
Exam
├── dates            notification / applyStart / applyEnd / examDate / cutoffAgeDate
├── ageRules[]       cutoff, minAge, maxAge{general,bc,bcm,mbc_dc,sc,sca,st},
│                    concessions{pwd,exServicemen,destituteWidow}{mode,value,byCategory},
│                    citation{quote,page,values[]}
├── qualifications[] minLevel, fieldSpecific, summary, citation
├── specialRequirements[]  autoCheck: female-only | tamil-sslc | no-pwd | serving-teacher | …
├── sources[]        official PDFs/HTML actually read
└── maintenance      verified (rules checked) | monitored (dates only) | announced (planner)
```

`maintenance: monitored` records never receive an eligibility verdict. That is deliberate: the
site says "I don't know" rather than guessing a limit.

## For agents and search engines

- `/llms.txt` — index plus citation rules
- `/llms-full.txt` — the entire dataset as plain text
- `/api/v1/exams.json` — structured rules with a schema version
- `/api/v1/changes.json`, `/api/v1/changes-7d.json` — dated diffs
- `/data/exams.csv` — flat table
- JSON-LD on every page (`WebPage`, `FAQPage`, `Dataset`, `BreadcrumbList`)
- `robots.txt` explicitly allows AI crawlers; content is CC BY 4.0

The rules are published, not hidden behind an endpoint, so an assistant can compute the same
verdict locally and cite the same paragraph.

## Honest limitations

- **Tamil-language PDFs** often have text layers that extract as garbage. Those sources are
  monitored by content hash, not by quote, and are labelled that way.
- **Post-specific annexures** are only covered where they have been transcribed. Anything not
  modelled is marked "dates tracked only".
- **The site can lag** between runs. Every page shows the last successful check time.
- **Personal details never leave the browser.** Date of birth, community and disability status are
  kept in local storage and are deliberately not written into shareable URLs.
- **Not legal advice.** The notification always wins.

## Layout

```
data/curated/exams/   hand-verified exam records (the product)
data/state/           snapshot, changelog, freshness, verification cache (generated)
scripts/refresh.ts    the scheduled pipeline
scripts/validate-data.ts  the CI gate
src/lib/core/         pure logic: dates, eligibility, diffing, quotation matching
src/lib/ingest/       network + PDF extraction + source adapters
src/pages/            Astro routes; API and feed endpoints live beside the pages
tests/                unit tests against real notification values
```

## Licence

Code MIT. Compilation CC BY 4.0. Official notices and PDFs remain the copyright of their issuing
authority. Independent project; not affiliated with TNPSC, TRB, TNUSRB or the Government of Tamil Nadu.
