import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ageOn, birthdayFor, daysBetween, extractDates, parseNotificationDate } from '../src/lib/core/dates';
import { findQuote, normalizeText } from '../src/lib/core/text';
import { diffFeed, parseOfficialDateChange, toDatedDoc } from '../src/lib/core/changelog';
import { evaluateExam, rankVerdicts, resolveMaxAge } from '../src/lib/core/eligibility';
import { ExamSchema, type Exam, type Profile } from '../src/lib/core/types';

const load = (name: string): Exam =>
  ExamSchema.parse(JSON.parse(readFileSync(join(__dirname, '..', 'data', 'curated', 'exams', `${name}.json`), 'utf8')));

const group4 = load('tnpsc-group-4-2026');
const group1 = load('tnpsc-group-1-2026');
const tet = load('trb-tet-2026');
const ctse = load('tnpsc-ctse-noninterview-2026');
const group2 = load('tnpsc-group-2-2026');
const diploma = load('tnpsc-ctse-diploma-2026');

const profile = (over: Partial<Profile>): Profile => ({
  dob: '1998-05-12',
  category: 'general',
  gender: 'female',
  qualification: 'degree',
  pwd: false,
  exServicemen: false,
  destituteWidow: false,
  servingTeacher: false,
  pstm: false,
  tamilMedium: true,
  tamilSslc: true,
  ...over,
});

describe('date parsing', () => {
  it('reads every format TNPSC uses', () => {
    expect(parseNotificationDate('27/09/2026')).toBe('2026-09-27');
    expect(parseNotificationDate('27.09.2026')).toBe('2026-09-27');
    expect(parseNotificationDate('27-09-2026')).toBe('2026-09-27');
    expect(parseNotificationDate('27 Sep 2026')).toBe('2026-09-27');
    expect(parseNotificationDate('September 27, 2026')).toBe('2026-09-27');
    expect(parseNotificationDate('2026-09-27')).toBe('2026-09-27');
  });

  it('rejects impossible dates instead of rolling them over', () => {
    expect(parseNotificationDate('31/02/2026')).toBeNull();
    expect(parseNotificationDate('not a date')).toBeNull();
  });

  it('extracts dates in order', () => {
    expect(extractDates('postponed from 06.09.2026 to 27.09.2026')).toEqual(['2026-09-06', '2026-09-27']);
  });
});

describe('age arithmetic', () => {
  it('counts completed years on the cut-off, not calendar years', () => {
    // Born 12 May 1998, cut-off 1 July 2026 -> 28 years, 1 month, 19 days.
    const a = ageOn('1998-05-12', '2026-07-01');
    expect(a.completedYears).toBe(28);
    expect(a.months).toBe(1);
    expect(a.days).toBe(19);
  });

  it('is exact on the birthday itself', () => {
    expect(ageOn('1994-07-01', '2026-07-01').completedYears).toBe(32);
    expect(ageOn('1994-07-02', '2026-07-01').completedYears).toBe(31);
  });

  it('handles 29 February', () => {
    expect(ageOn('2000-02-29', '2026-02-28').completedYears).toBe(25);
    expect(ageOn('2000-02-29', '2026-03-01').completedYears).toBe(26);
  });

  it('reports the birthday on which a minimum age is met', () => {
    expect(birthdayFor('2008-01-15', 18)).toBe('2026-01-15');
  });

  it('counts days across a leap day', () => {
    expect(daysBetween('2027-12-31', '2028-03-01')).toBe(61);
  });
});

describe('quotation matching', () => {
  const page = '4.1. Age Limit: (as on 01.07.2026)\nThe candidates should have completed the\nminimum age of 21 years for all posts.';

  it('matches across PDF line wrapping', () => {
    expect(findQuote('The candidates should have completed the minimum age of 21 years', [page]).found).toBe(true);
  });

  it('matches text broken by a hyphenated line break', () => {
    expect(findQuote('the exam was postponed', ['the exam was post-\nponed']).found).toBe(true);
  });

  it('normalises smart quotes and dashes', () => {
    expect(normalizeText('“Don’t” — 32')).toBe('"don\'t" - 32');
  });

  it('fails when a number changed in the document', () => {
    expect(findQuote('minimum age of 22 years', [page]).found).toBe(false);
  });
});

describe('official date-change extraction', () => {
  it('reads the real Group I addendum sentence', () => {
    const text =
      'The Preliminary Examination for the posts in Combined Civil Services Examination - I (Group I Services), announced in Notification No. 05/2026, dated 23.06.2026 has been postponed from 06.09.2026 to 27.09.2026. The date and time of preliminary examination mentioned in para 1.2. shall be read as follows:-';
    const parsed = parseOfficialDateChange(text);
    expect(parsed?.before).toBe('2026-09-06');
    expect(parsed?.after).toBe('2026-09-27');
    expect(parsed?.quote).toContain('postponed');
  });

  it('ignores a document with no date change', () => {
    expect(parseOfficialDateChange('The number of vacancies for the following posts are revised.')).toBeNull();
  });
});

describe('feed diffing', () => {
  const doc = (title: string, category = 'Addendum', url = 'https://example.org/a.pdf') => ({
    category,
    title,
    url,
    uploadedAt: '16-07-2026',
  });

  it('flags a newly published addendum as a change', () => {
    const base = {
      examId: 'x',
      sourceExamId: 'n',
      title: 'Exam',
      docs: [toDatedDoc(doc('Addendum 5A'), '2026-07-01T00:00:00Z')],
      examDateRaw: '07/06/2026',
      applyRaw: null,
      fetchedAt: '2026-07-01T00:00:00Z',
      sourceUrl: 'https://example.org',
    };
    const next = {
      ...base,
      docs: [...base.docs, toDatedDoc(doc('Addendum 5B', 'Addendum', 'https://example.org/b.pdf'), '2026-08-01T00:00:00Z')],
      examDateRaw: '27/09/2026',
      fetchedAt: '2026-08-01T00:00:00Z',
    };
    const diffs = diffFeed(base, next, false);
    expect(diffs.map((d) => d.kind)).toContain('new_addendum');
    expect(diffs.map((d) => d.kind)).toContain('exam_date_changed');
    const dateDiff = diffs.find((d) => d.kind === 'exam_date_changed');
    expect(dateDiff?.before).toBe('2026-06-07');
    expect(dateDiff?.after).toBe('2026-09-27');
  });

  it('produces no events on the baseline run', () => {
    const base = {
      examId: 'x',
      sourceExamId: 'n',
      title: 'Exam',
      docs: [],
      examDateRaw: null,
      applyRaw: null,
      fetchedAt: '2026-07-01T00:00:00Z',
      sourceUrl: 'https://example.org',
    };
    expect(diffFeed(null, base, true)).toEqual([]);
  });
});

describe('Group IV age limits (Notification 11/2026)', () => {
  it('rejects a 31-year-old general candidate for the standard posts', () => {
    const v = evaluateExam(group4, profile({ dob: '1995-01-01' })); // 31 on 01-07-2026
    const standard = v.rules.find((r) => r.ruleId === 'most-posts');
    expect(standard?.ageStatus).toBe('fail');
  });

  it('accepts the same candidate for Executive Officer Grade IV (25–35)', () => {
    const v = evaluateExam(group4, profile({ dob: '1995-01-01' }));
    const eo = v.rules.find((r) => r.ruleId === 'executive-officer-grade-4');
    expect(eo?.ageStatus).toBe('pass');
    expect(eo?.maxAge).toBe(35);
    expect(v.status).toBe('partial');
  });

  it('gives BC candidates a ceiling of 32 at the minimum qualification', () => {
    const rule = group4.ageRules.find((r) => r.id === 'most-posts')!;
    expect(resolveMaxAge(rule, profile({ category: 'bc', qualification: 'sslc' })).max).toBe(32);
    expect(resolveMaxAge(rule, profile({ category: 'sc', qualification: 'sslc' })).max).toBe(35);
  });

  it('removes the reserved ceiling for a candidate above the minimum qualification (footnote #)', () => {
    const rule = group4.ageRules.find((r) => r.id === 'most-posts')!;
    expect(resolveMaxAge(rule, profile({ category: 'bc', qualification: 'hsc' })).max).toBe(60);
    // The footnote applies to reserved categories only.
    expect(resolveMaxAge(rule, profile({ category: 'general', qualification: 'degree' })).max).toBe(30);
  });

  it('applies the reserved PwBD ceiling of 42, not the general 40', () => {
    const rule = group4.ageRules.find((r) => r.id === 'most-posts')!;
    expect(resolveMaxAge(rule, profile({ category: 'bc', pwd: true, qualification: 'sslc' })).max).toBe(42);
    expect(resolveMaxAge(rule, profile({ category: 'general', pwd: true, qualification: 'sslc' })).max).toBe(40);
  });

  it('blocks PwBD candidates on Forest Guard posts', () => {
    const v = evaluateExam(group4, profile({ pwd: true, dob: '1995-01-01' }));
    const forest = v.rules.find((r) => r.ruleId === 'forest-guard-driving-licence');
    expect(forest?.ageStatus).toBe('fail');
  });

  it('rejects a 17-year-old for every Group IV rule', () => {
    const v = evaluateExam(group4, profile({ dob: '2009-01-01' }));
    expect(v.status).toBe('ineligible');
    expect(v.blockers.join(' ')).toMatch(/Minimum age is 18|minimum/i);
  });
});

describe('Group I age limits (Notification 05/2026)', () => {
  it('allows a 38-year-old SC candidate but not a 38-year-old general candidate', () => {
    expect(evaluateExam(group1, profile({ dob: '1988-01-01', category: 'sc' })).status).toBe('eligible');
    const general = evaluateExam(group1, profile({ dob: '1988-01-01', category: 'general' }));
    expect(general.status).toBe('ineligible');
  });

  it('names the concession when one is used', () => {
    const v = evaluateExam(group1, profile({ dob: '1990-01-01', category: 'general', pwd: true }));
    const rule = v.rules[0];
    expect(rule.maxAge).toBe(44);
    expect(rule.concession).toContain('PwBD');
  });
});

describe('no age limit', () => {
  it('treats TET as having no age bar but blocks non-teachers', () => {
    const v = evaluateExam(tet, profile({ dob: '1975-01-01' }));
    expect(v.criteria.find((c) => c.id === 'age-none')?.status).toBe('pass');
    expect(v.status).toBe('ineligible');
    expect(v.blockers.join(' ')).toMatch(/serving teacher|working teacher/i);
  });

  it('passes a serving teacher with the right qualification', () => {
    const v = evaluateExam(tet, profile({ dob: '1975-01-01', servingTeacher: true, qualification: 'pg' }));
    expect(v.status).not.toBe('ineligible');
  });
});

describe('Group II reserved-category rule (Notification 07/2026)', () => {
  it('caps a general candidate at 32 but leaves a reserved candidate without a ceiling below 60', () => {
    const rule = group2.ageRules.find((r) => r.id === 'most-posts')!;
    expect(resolveMaxAge(rule, profile({ category: 'general' })).max).toBe(32);
    expect(resolveMaxAge(rule, profile({ category: 'sc' })).max).toBe(60);
    expect(resolveMaxAge(rule, profile({ category: 'mbc_dc' })).max).toBe(60);
  });

  it('still rejects a reserved candidate who has completed 60', () => {
    const v = evaluateExam(group2, profile({ dob: '1965-01-01', category: 'sc' }));
    const rule = group2.ageRules.find((r) => r.id === 'most-posts')!;
    expect(resolveMaxAge(rule, profile({ category: 'sc' })).max).toBe(60);
    expect(v.rules.find((r) => r.ruleId === 'most-posts')?.ageStatus).toBe('fail');
  });
});

describe('CTSE diploma (Notification 06/2026)', () => {
  it('uses a later cut-off for Junior Training Officer than for the rest of the examination', () => {
    const jto = diploma.ageRules.find((r) => r.id === 'junior-training-officer')!;
    expect(jto.cutoff).toBe('2026-08-01');
    expect(jto.minAge).toBe(21);
  });

  it('blocks PwBD candidates on Motor Vehicle Inspector', () => {
    const mvi = diploma.ageRules.find((r) => r.id === 'motor-vehicle-inspector')!;
    expect(resolveMaxAge(mvi, profile({ pwd: true })).blocked).toMatch(/not eligible/i);
  });
});

describe('qualification handling', () => {
  it('fails an SSLC-only candidate on a degree exam', () => {
    const v = evaluateExam(group1, profile({ qualification: 'sslc' }));
    expect(v.status).toBe('ineligible');
    expect(v.blockers.join(' ')).toMatch(/Requires Bachelor/i);
  });

  it('flags subject-specific degrees as needing a check, not an outright pass', () => {
    const v = evaluateExam(ctse, profile({ qualification: 'degree' }));
    expect(v.status).toBe('needs_check');
  });
});

describe('CTSE non-interview (Notification 04/2026)', () => {
  it('gives reserved categories the defined no-maximum ceiling of 60 while general stays at 32', () => {
    const rule = ctse.ageRules.find((r) => r.id === 'standard-posts')!;
    expect(resolveMaxAge(rule, profile({})).max).toBe(32);
    expect(resolveMaxAge(rule, profile({ category: 'sc' })).max).toBe(60);
  });

  it('keeps a 55-year-old general candidate out even though reserved categories have no ceiling', () => {
    const v = evaluateExam(ctse, profile({ dob: '1971-01-01' }));
    expect(v.rules.find((r) => r.ruleId === 'standard-posts')?.ageStatus).toBe('fail');
  });
});

describe('ranking', () => {
  it('puts eligible exams before ineligible ones', () => {
    const p = profile({ dob: '1999-01-01' });
    const exams = [group1, group4, tet, ctse];
    const ranked = rankVerdicts(exams.map((e) => evaluateExam(e, p)), exams);
    const firstIneligible = ranked.findIndex((v) => v.status === 'ineligible');
    const firstEligible = ranked.findIndex((v) => v.status === 'eligible');
    if (firstEligible >= 0 && firstIneligible >= 0) expect(firstEligible).toBeLessThan(firstIneligible);
  });
});
