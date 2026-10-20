import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { onRequestGet, onRequestPost, readProfile } from '../functions/api/eligibility';

const dataset = readFileSync(join(__dirname, '..', 'dist', 'api', 'v1', 'exams.json'), 'utf8');

const env = {
  ASSETS: {
    fetch: async () =>
      new Response(dataset, { status: 200, headers: { 'content-type': 'application/json' } }),
  },
};

const ctx = (url: string, init?: RequestInit) => ({ request: new Request(url, init), env });

describe('runtime eligibility function', () => {
  it('rejects a malformed date of birth', async () => {
    const res = await onRequestGet(ctx('https://example.org/api/eligibility?dob=12-05-1998&category=bc'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.field).toBe('dob');
  });

  it('rejects an unknown community', async () => {
    const res = await onRequestGet(ctx('https://example.org/api/eligibility?dob=1998-05-12&category=obc'));
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe('category');
  });

  it('answers a GET request with ranked verdicts', async () => {
    const res = await onRequestGet(
      ctx('https://example.org/api/eligibility?dob=1998-05-12&category=bc&qualification=degree&gender=female'),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.checkedExams).toBeGreaterThan(0);
    expect(body.summary.eligible + body.summary.partial + body.summary.needsCheck + body.summary.ineligible).toBe(
      body.checkedExams,
    );
    expect(body.verdicts[0]).toHaveProperty('criteria');
  });

  it('answers a POST body the same way', async () => {
    const res = await onRequestPost(
      ctx('https://example.org/api/eligibility', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dob: '1995-01-01', category: 'general', qualification: 'sslc' }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // SSLC-only cannot meet a degree requirement, so nothing should be "eligible".
    expect(body.summary.eligible).toBe(0);
  });

  it('defaults optional claims to false rather than guessing them true', () => {
    const { profile } = readProfile({ dob: '1998-05-12' });
    expect(profile?.pwd).toBe(false);
    expect(profile?.exServicemen).toBe(false);
    expect(profile?.servingTeacher).toBe(false);
    // Conservative: Tamil-at-SSLC is a claim the caller must make explicitly.
    expect(profile?.tamilSslc).toBe(false);
  });
});
