# Data model and maintenance

The site is a view over two kinds of file:

- **curated** — transcribed facts, one JSON file per notification (`data/curated/exams/`)
- **state** — machine-produced record of what the boards published (`data/state/`)

Nothing in `data/state/` is edited by hand.

---

## A curated exam

```jsonc
{
  "id": "tnpsc-group-4-2026",        // must equal "slug"
  "slug": "tnpsc-group-4-2026",      // URL: /exams/<slug>
  "board": "tnpsc",                  // tnpsc | trb | tnusrb | tn-health | other
  "notificationNo": "11/2026",
  "maintenance": "verified",         // verified = rules checked; monitored = dates only
  "dates": {
    "notification": "2026-10-06",
    "applyStart": "2026-10-06",
    "applyEnd": "2026-11-05",
    "examDate": "2027-01-10",
    "cutoffAgeDate": "2026-07-01"
  },
  "hasAgeLimit": true,
  "ageRules": [ /* see below */ ],
  "qualifications": [ /* see below */ ],
  "sources": [ /* the documents actually read */ ]
}
```

`schema` lives in `src/lib/core/types.ts`. A file that does not validate is
skipped at build time and rejected by `pnpm validate`.

### Age rules

One rule per distinct set of limits. Group IV, for example, has four: the main
clerical cluster, the Village Administrative Officer, Executive Officer
(Grade IV) and the forest posts.

```jsonc
{
  "id": "most-posts",
  "label": "Most Group IV posts",
  "cutoff": "2026-07-01",
  "minAge": 18,
  "maxAge": {
    "general": 30, "bc": 32, "bcm": 32, "mbc_dc": 32,
    "sc": 35, "sca": 35, "st": 35
  },
  "concessions": {
    "pwd": {
      "mode": "absolute",
      "value": 40,
      "byCategory": { "general": 40, "bc": 42, "sc": 45 }
    },
    "exServicemen": { "mode": "absolute", "value": 48 },
    "destituteWidow": { "mode": "absolute", "value": 35 }
  },
  "citation": {
    "quote": "The category wise maximum age limit and age concession details are given below:",
    "page": 5,
    "values": [18, 30, 40, 48]
  }
}
```

- `maxAge: null` means the notification states there is no maximum.
- `mode` is `absolute` (the table prints a flat ceiling), `add` (years added) or
  `blocked` (the category cannot apply — for example PwBD on Forest Guard posts).
- `byCategory` is used when the table prints different concession ceilings per
  community, which TNPSC frequently does.
- `cutoff` is per rule, because a single notification can use two dates. The
  Junior Training Officer posts in Notification 06/2026 are measured on
  01.08.2026 while the rest of that examination is measured on 01.07.2026.

### Citations

Every rule and qualification carries a `citation`:

- `quote` — text copied **exactly** from the document. The validator normalises
  whitespace, smart quotes and hyphenated line breaks, then searches for it.
- `page` — the printed page number.
- `values` — numbers that must still appear on that page. Used for facts taken
  from a table, where the numbers cannot be quoted as a sentence.

If a quotation cannot be found, the examination is flagged and the eligibility
answer is withheld. It is never quietly updated.

### Qualification rules

```jsonc
{
  "minLevel": "sslc",          // none | sslc | hsc | iti | diploma | degree | pg
  "fieldSpecific": false,      // true -> verdict becomes "verify", not "eligible"
  "summary": "A pass in the SSLC public examination.",
  "citation": { "quote": "…", "page": 22 }
}
```

### Special requirements

```jsonc
{
  "id": "tamil-eligibility",
  "severity": "blocking",
  "autoCheck": "tamil-sslc",   // female-only | tamil-sslc | no-pwd
                               // physical-standards | tn-resident | serving-teacher | none
  "detail": "…"
}
```

`autoCheck: "none"` is display-only: the condition is shown but not evaluated, so
it never turns into a false verdict.

---

## What the pipeline writes

| File | Contents |
|---|---|
| `state/snapshot.json` | every examination's document list and raw date lines, last seen |
| `state/changelog.json` | dated diffs, newest first, with evidence and source URL |
| `state/verify.json` | ETag / hash / per-citation verdicts used to replay a 304 |
| `state/citations.json` | the latest verification report per examination |
| `state/freshness.json` | last check per board endpoint, plus staleness per examination |
| `state/feeds.json` | compact live feed used by the pages |

`--rebuild-log` regenerates the changelog from the sources instead of appending.

---

## Adding a notification, end to end

```bash
pnpm new:exam tnpsc-group-3-2027      # skeleton with placeholders
# edit data/curated/exams/tnpsc-group-3-2027.json
pnpm refresh                          # downloads the PDF, checks every quote
pnpm validate                         # fails on a wrong page, a missing quote or stale data
pnpm test
pnpm build
```

The refresh output prints the page it searched and how much of the quotation it
matched, which is usually enough to find a transcription slip.

### Common mistakes

- **Quoting a table row.** Row text reorders depending on the PDF extractor.
  Quote the table heading or a prose sentence and put the numbers in `values`.
- **Using the wrong page.** Pages are the printed numbers (`Page 5 of 85`), not
  the PDF page index, which can differ when a cover page is unnumbered.
- **Assuming one age rule per examination.** Check for post clusters and
  footnotes (`*`, `#`, `%`) that change a ceiling.
- **Reading "No maximum age limit" as unlimited.** TNPSC defines it as not
  having completed 60 years. Record 60, not `null`, unless the document really
  says there is no limit.
- **Forgetting that reserved categories may have no ceiling at all.** In
  Notifications 04, 06, 07 and 8 of 2026 they do not, for most posts. That is a
  real and useful fact — record it rather than copying the general number.

---

## Reviewing a flagged examination

When `pnpm refresh` reports a quotation issue:

1. Open the official document at the cited page.
2. Decide which is wrong — the document changed, or the transcription.
3. If the document changed, update the rule, the quotation and the numbers, and
   note the change in `editorialNote`.
4. If the transcription was wrong, fix it.
5. Run `pnpm refresh && pnpm validate`. Commit both the data and the new state.

The site keeps serving the last verified value with a visible warning until this
is done. That is intentional: an unverified number behind a warning is safer than
a confident wrong one.
