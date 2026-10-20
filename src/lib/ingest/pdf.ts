import { extractText, getDocumentProxy } from 'unpdf';
import { sha256Hex } from '../core/text';

export interface PdfText {
  pages: string[];
  text: string;
  pageCount: number;
  sha256: string;
  chars: number;
}

/**
 * Extract per-page text from a PDF buffer. Per-page output is what lets the UI
 * cite "page 3 of the notification" instead of a vague document reference.
 */
export async function extractPdf(bytes: Uint8Array): Promise<PdfText> {
  const hash = await sha256Hex(bytes);
  const pdf = await getDocumentProxy(bytes);
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pages = (Array.isArray(text) ? text : [text]).map((p) => p.replace(/\u0000/g, ''));
  return {
    pages,
    text: pages.join('\n\f\n'),
    pageCount: totalPages,
    sha256: hash,
    chars: pages.reduce((n, p) => n + p.length, 0),
  };
}

/** Strip scripts/styles and collapse tags for HTML sources. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d|table|section)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
