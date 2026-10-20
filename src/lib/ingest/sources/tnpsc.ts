import { parse } from 'node-html-parser';
import { fetchResource, type FetchResult } from '../http';

/**
 * TNPSC (Tamil Nadu Public Service Commission) — exam dashboard.
 *
 * The dashboard is a .NET WebForms page: the year selector triggers a postback
 * that requires the hidden `__VIEWSTATE` and `__CSRF_TOKEN`. Every exam card
 * links to a detail page whose document table is the authoritative record of
 * what the Commission published and when.
 */

export const TNPSC_BASE = 'https://tnpsc.gov.in';
export const DASHBOARD_URL = `${TNPSC_BASE}/web/examdashboard/index.aspx`;
export const PUBLIC_DASHBOARD_URL = `${DASHBOARD_URL}?key=ksojs2efre3WFDsw5`;

export interface TnpscExamRef {
  title: string;
  notid: string;
  notificationNo: string | null;
  year: number | null;
}

export interface TnpscDoc {
  category: string;
  title: string;
  url: string | null;
  uploadedAt: string | null;
}

export interface TnpscExamDetail {
  notid: string;
  title: string;
  docs: TnpscDoc[];
  examDateRaw: string | null;
  applyRaw: string | null;
  pageUrl: string;
}

/** "COMBINED CIVIL SERVICES EXAMINATION - I (GROUP I SERVICES) - 05/2026" */
export function parseTitle(title: string): { name: string; notificationNo: string | null; year: number | null } {
  const m = title.match(/(\d{1,3})\s*\/\s*(\d{4})\s*$/);
  const notificationNo = m ? `${Number(m[1])}/${m[2]}` : null;
  const name = (m ? title.slice(0, m.index) : title).replace(/[\s–-]+$/, '').trim();
  return { name, notificationNo, year: m ? Number(m[2]) : null };
}

function hiddenFields(html: string): Record<string, string> {
  const root = parse(html);
  const out: Record<string, string> = {};
  for (const input of root.querySelectorAll('input[type=hidden]')) {
    const name = input.getAttribute('name');
    if (name) out[name] = input.getAttribute('value') ?? '';
  }
  return out;
}

function examRefs(html: string): TnpscExamRef[] {
  const root = parse(html);
  return root
    .querySelectorAll('#examlist a[href*="notid="]')
    .map((a) => {
      const href = a.getAttribute('href') ?? '';
      const notid = new URL(href, DASHBOARD_URL).searchParams.get('notid') ?? '';
      const title = a.text.replace(/\s+/g, ' ').trim();
      const meta = parseTitle(title);
      return { title, notid, ...meta };
    })
    .filter((e) => e.notid);
}

/** The year currently selected by the server, used to skip redundant postbacks. */
function selectedYear(html: string): number | null {
  const el = parse(html).querySelector('option[selected]');
  const v = el?.getAttribute('value');
  return v ? Number(v) : null;
}

export class TnpscClient {
  private viewState: { url: string; fields: Record<string, string>; cookies: string } | null = null;
  public lastResponse: FetchResult | null = null;

  private async loadDashboard(): Promise<{ html: string; res: FetchResult }> {
    const res = await fetchResource(PUBLIC_DASHBOARD_URL, { timeoutMs: 30_000, retries: 1 });
    this.lastResponse = res;
    this.viewState = {
      url: res.url,
      fields: hiddenFields(res.text),
      cookies: res.cookies,
    };
    return { html: res.text, res };
  }

  /** All exam cards for a calendar year, switching years via postback when needed. */
  async listExams(year: number): Promise<TnpscExamRef[]> {
    const first = await this.loadDashboard();
    if (selectedYear(first.html) === year) return examRefs(first.html);
    if (!this.viewState) return examRefs(first.html);

    const res = await fetchResource(this.viewState.url, {
      timeoutMs: 30_000,
      retries: 1,
      method: 'POST',
      body: new URLSearchParams({
        ...this.viewState.fields,
        __EVENTTARGET: 'ddlYear',
        __EVENTARGUMENT: '',
        ddlYear: String(year),
      }).toString(),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        referer: this.viewState.url,
        origin: TNPSC_BASE,
        ...(this.viewState.cookies ? { cookie: this.viewState.cookies } : {}),
      },
    });
    return examRefs(res.text);
  }

  async detail(notid: string): Promise<TnpscExamDetail> {
    const pageUrl = `${DASHBOARD_URL}?notid=${notid}`;
    const res = await fetchResource(pageUrl, { timeoutMs: 25_000, retries: 1 });
    const root = parse(res.text);
    const title = root.querySelector('.card-title')?.text.replace(/\s+/g, ' ').trim() ?? '';

    const docs: TnpscDoc[] = [];
    let examDateRaw: string | null = null;
    let applyRaw: string | null = null;

    for (const tr of root.querySelectorAll('#pnlExamInfo table tr')) {
      const tds = tr.querySelectorAll(':scope > td');
      if (tds.length < 4) continue;
      const category = tds[0].text.replace(/\s+/g, ' ').trim();
      const docTitle = tds[1].text.replace(/\s+/g, ' ').trim();
      const anchor = tds[2].querySelector('a');
      const url = anchor?.getAttribute('href') ?? null;
      const uploadedAt = tds[3].text.replace(/\s+/g, ' ').trim() || null;
      if (!category || !docTitle) continue;

      if (category === 'Date of Examination') {
        examDateRaw = docTitle.replace(/^Date of Examination\s*:\s*/i, '').trim();
        continue;
      }
      if (category === 'Apply Online') {
        applyRaw = docTitle;
        continue;
      }
      let safeUrl: string | null = null;
      if (url) {
        try {
          const abs = new URL(url, TNPSC_BASE);
          if (abs.protocol === 'http:' || abs.protocol === 'https:') safeUrl = abs.toString();
        } catch {
          safeUrl = null;
        }
      }
      docs.push({ category, title: docTitle, url: safeUrl, uploadedAt });
    }

    return { notid, title, docs, examDateRaw, applyRaw, pageUrl };
  }
}
