/**
 * Provenance primitives.
 *
 * The promise of this site is that a rule shown to a candidate is present,
 * verbatim, in the government document it cites. `findQuote` is the gate that
 * enforces it: it runs against freshly extracted PDF/HTML text on every
 * refresh, so a re-issued notification that changes a number fails loudly
 * instead of silently serving an old answer.
 */

const LIGATURE_MAP: Record<string, string> = {
  '\uFB00': 'ff', '\uFB01': 'fi', '\uFB02': 'fl', '\uFB03': 'ffi',
  '\uFB04': 'ffl', '\uFB05': 'st', '\uFB06': 'st',
};

export function normalizeText(input: string): string {
  let s = input.replace(/\u00a0/g, ' ').replace(/\u2007|\u202f/g, ' ');
  s = s.replace(/[\u2018\u2019\u201b]/g, "'").replace(/[\u201c\u201d]/g, '"');
  s = s.replace(/[\u2013\u2014]/g, '-').replace(/\u00ad/g, '');
  s = s.replace(/[\uFB00-\uFB06]/g, (m) => LIGATURE_MAP[m] ?? m);
  // PDF line-wrapping: "post-\nponed" becomes "postponed"
  s = s.replace(/(\w)-\s*\n\s*(\w)/g, '$1$2');
  s = s.replace(/\s+/g, ' ');
  return s.trim().toLowerCase();
}

export interface QuoteMatch {
  found: boolean;
  /** Page (1-based) containing the quote, when page-level text is available. */
  page?: number;
  /** Short surrounding context for debugging / evidence display. */
  snippet?: string;
  /** How many characters of the quote matched at the best position (0..1). */
  score: number;
}

/**
 * Locate `quote` inside `pages` (one string per page) after normalisation.
 * Falls back to a longest-prefix match so a truncated or hyphenated PDF still
 * produces a useful diagnostic rather than a bare failure.
 */
export function findQuote(quote: string, pages: string[]): QuoteMatch {
  const q = normalizeText(quote);
  if (!q) return { found: false, score: 0 };

  for (let i = 0; i < pages.length; i++) {
    const hay = normalizeText(pages[i]);
    const idx = hay.indexOf(q);
    if (idx !== -1) {
      return {
        found: true,
        page: i + 1,
        score: 1,
        snippet: pages[i].replace(/\s+/g, ' ').slice(Math.max(0, idx - 60), idx + q.length + 60).trim(),
      };
    }
  }

  // Diagnostic: find the page sharing the most leading tokens.
  const tokens = q.split(' ').filter(Boolean);
  let best = { page: undefined as number | undefined, score: 0 };
  for (let i = 0; i < pages.length; i++) {
    const hay = normalizeText(pages[i]);
    if (!hay.includes(tokens[0] ?? '')) continue;
    let lo = 0;
    let hi = tokens.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (hay.includes(tokens.slice(0, mid).join(' '))) lo = mid;
      else hi = mid - 1;
    }
    const score = tokens.length ? lo / tokens.length : 0;
    if (score > best.score) best = { page: i + 1, score };
  }
  return { found: false, page: best.page, score: best.score };
}

export interface CitationIssue {
  examId: string;
  where: string;
  quote: string;
  page?: number;
  score: number;
  snippet?: string;
}

export function sha256Hex(input: string | Uint8Array): Promise<string> {
  const data =
    typeof input === 'string' ? new TextEncoder().encode(input) : (input as unknown as BufferSource);
  return crypto.subtle.digest('SHA-256', data).then((buf) =>
    [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join(''),
  );
}
