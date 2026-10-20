/**
 * Optional runtime eligibility endpoint for Cloudflare Pages.
 *
 * Static hosting already publishes the rules, so an agent can compute the
 * verdict itself. This function exists for clients that would rather POST a
 * profile and get an answer — it reuses the exact same engine and the same
 * published dataset, so both routes cannot drift.
 *
 *   GET  /api/eligibility?dob=1998-05-12&category=bc&qualification=degree
 *   POST /api/eligibility   {"dob":"1998-05-12","category":"bc","qualification":"degree"}
 *
 * Deploy: keep this file at `functions/api/eligibility.ts`; Cloudflare Pages
 * picks it up automatically. Nothing else is required.
 */

import { evaluateExam, rankVerdicts } from '../../src/lib/core/eligibility';
import type { Exam, Profile } from '../../src/lib/core/types';

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

interface Ctx {
  request: Request;
  env: Env;
}

const CATEGORIES = new Set(['general', 'bc', 'bcm', 'mbc_dc', 'sc', 'sca', 'st']);
const QUALIFICATIONS = new Set(['none', 'sslc', 'hsc', 'iti', 'diploma', 'degree', 'pg']);
const GENDERS = new Set(['male', 'female', 'other']);

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...CORS,
    },
  });
}

function bad(message: string, field?: string): Response {
  return json({ error: 'invalid_request', message, ...(field ? { field } : {}) }, 400);
}

const truthy = (v: unknown): boolean => v === true || v === '1' || v === 'true' || v === 'yes' || v === 'on';

export function readProfile(input: Record<string, unknown>): { profile?: Profile; error?: { message: string; field?: string } } {
  const dob = String(input.dob ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return { error: { message: 'dob must be YYYY-MM-DD', field: 'dob' } };
  const asDate = new Date(`${dob}T00:00:00Z`);
  if (Number.isNaN(asDate.getTime())) return { error: { message: 'dob is not a real date', field: 'dob' } };
  // 1998-02-31 rolls over to 3 March; require a round trip.
  if (asDate.toISOString().slice(0, 10) !== dob) return { error: { message: 'dob is not a real date', field: 'dob' } };
  const year = asDate.getUTCFullYear();
  if (year < 1940 || asDate.getTime() > Date.now()) {
    return { error: { message: 'dob must be between 1940 and today', field: 'dob' } };
  }

  const category = String(input.category ?? 'general');
  if (!CATEGORIES.has(category)) return { error: { message: `category must be one of: ${[...CATEGORIES].join(', ')}`, field: 'category' } };

  const qualification = String(input.qualification ?? input.qual ?? 'degree');
  if (!QUALIFICATIONS.has(qualification)) {
    return { error: { message: `qualification must be one of: ${[...QUALIFICATIONS].join(', ')}`, field: 'qualification' } };
  }

  const gender = String(input.gender ?? 'other');
  if (!GENDERS.has(gender)) return { error: { message: `gender must be one of: ${[...GENDERS].join(', ')}`, field: 'gender' } };

  return {
    profile: {
      dob,
      category: category as Profile['category'],
      gender: gender as Profile['gender'],
      qualification: qualification as Profile['qualification'],
      pwd: truthy(input.pwd),
      exServicemen: truthy(input.exServicemen ?? input.exsm),
      destituteWidow: truthy(input.destituteWidow ?? input.widow),
      servingTeacher: truthy(input.servingTeacher ?? input.teacher),
      pstm: truthy(input.pstm),
      tamilMedium: input.tamilMedium === undefined ? true : truthy(input.tamilMedium),
      tamilSslc: input.tamilSslc === undefined ? false : truthy(input.tamilSslc),
    },
  };
}

/** The published JSON nests age rules under `ageLimit`; the engine wants them flat. */
function toEngineExam(raw: Record<string, any>): Exam {
  return {
    ...(raw as unknown as Exam),
    hasAgeLimit: raw.ageLimit?.hasAgeLimit ?? true,
    ageRules: raw.ageLimit?.rules ?? [],
  };
}

async function loadExams(ctx: Ctx): Promise<Exam[]> {
  const url = new URL('/api/v1/exams.json', ctx.request.url).toString();
  const res = await ctx.env.ASSETS.fetch(new Request(url, { headers: { accept: 'application/json' } }));
  if (!res.ok) throw new Error(`dataset unavailable (${res.status})`);
  const data = (await res.json()) as { exams?: Array<Record<string, any>> };
  return (data.exams ?? [])
    .filter((e) => (e.maintained ?? e.maintenance) === 'verified')
    .map(toEngineExam);
}

async function handle(ctx: Ctx): Promise<Response> {
  let input: Record<string, unknown> = {};
  if (ctx.request.method === 'POST') {
    const declared = Number(ctx.request.headers.get('content-length') ?? '0');
    if (declared > 4096) return bad('body too large');
    try {
      const parsed = (await ctx.request.json()) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return bad('body must be a JSON object');
      }
      input = parsed as Record<string, unknown>;
    } catch {
      return bad('body must be JSON');
    }
  } else {
    input = Object.fromEntries(new URL(ctx.request.url).searchParams.entries());
  }

  const parsed = readProfile(input);
  if (parsed.error) return bad(parsed.error.message, parsed.error.field);
  const profile = parsed.profile!;

  let exams: Exam[];
  try {
    exams = await loadExams(ctx);
  } catch (err) {
    return json({ error: 'dataset_unavailable', message: (err as Error).message }, 503);
  }

  const verdicts = rankVerdicts(exams.map((e) => evaluateExam(e, profile)), exams);
  return json({
    schemaVersion: '1.0.0',
    profile,
    checkedExams: exams.length,
    summary: {
      eligible: verdicts.filter((v) => v.status === 'eligible').length,
      partial: verdicts.filter((v) => v.status === 'partial').length,
      needsCheck: verdicts.filter((v) => v.status === 'needs_check').length,
      ineligible: verdicts.filter((v) => v.status === 'ineligible').length,
    },
    verdicts,
    disclaimer:
      'Computed from ExamLens’s source-verified dataset. The official notification prevails. Age is measured on each notification’s own cut-off date.',
  });
}

export const onRequestGet = (ctx: Ctx) => handle(ctx);
export const onRequestPost = (ctx: Ctx) => handle(ctx);
export const onRequestOptions = () => new Response(null, { status: 204, headers: CORS });
