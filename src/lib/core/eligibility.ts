import type {
  AgeRule,
  Category,
  Concession,
  Exam,
  Profile,
  QualificationRule,
  SpecialRequirement,
} from './types';
import { QUALIFICATION_RANK, RELAXED_CATEGORIES, CATEGORY_LABELS, QUALIFICATION_LABELS } from './constants';
import { ageOn, birthdayFor, formatDate } from './dates';

export type CheckStatus = 'pass' | 'fail' | 'unknown' | 'info';

export interface Criterion {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  source?: { url?: string; page?: number; quote?: string };
}

export interface RuleOutcome {
  ruleId: string;
  label: string;
  postNames: string[];
  ageStatus: CheckStatus;
  minAge: number;
  maxAge: number | null;
  ageAtCutoff: number;
  concession: string | null;
  detail: string;
}

export type Verdict = 'eligible' | 'partial' | 'ineligible' | 'needs_check';

export interface ExamVerdict {
  examId: string;
  examName: string;
  shortName: string;
  slug: string;
  status: Verdict;
  headline: string;
  ageAtCutoff: number;
  cutoff: string;
  effectiveMaxAge: number | null;
  appliedConcessions: string[];
  criteria: Criterion[];
  rules: RuleOutcome[];
  blockers: string[];
  nearMiss: string | null;
}

function sourceOf(citation: { page?: number; quote?: string }, url?: string) {
  return { url, page: citation.page, quote: citation.quote };
}

/** Resolve the maximum age for a category, honouring the notification's table. */
function baseMaxFor(rule: AgeRule, category: Category): number | null {
  if (rule.maxAge === null) return null;
  const specific = rule.maxAge[category];
  if (specific !== undefined && specific !== null) return specific;
  const general = rule.maxAge.general;
  return general ?? null;
}

interface MaxResolution {
  max: number | null;
  blocked?: string;
  concession: string | null;
}

function applyConcession(
  base: number | null,
  c: Concession | null | undefined,
  label: string,
  category: Category,
): { max: number | null; blocked?: string; applied?: string } {
  if (!c) return { max: base };
  if (c.mode === 'blocked') return { max: base, blocked: `${label} candidates are not eligible for this post.` };
  if (base === null) return { max: null };
  const limit = c.byCategory?.[category] ?? c.value;
  if (c.mode === 'absolute') return { max: Math.max(base, limit), applied: `${label} limit ${limit}` };
  return { max: base + limit, applied: `${label} +${limit} years` };
}

/** The most favourable maximum age this candidate can claim. */
export function resolveMaxAge(rule: AgeRule, profile: Profile): MaxResolution {
  const hq = rule.higherQualificationMax;
  if (hq) {
    const appliesToCategory = hq.categories === 'all' || profile.category !== 'general';
    const higher = QUALIFICATION_RANK[profile.qualification] > QUALIFICATION_RANK[hq.aboveLevel];
    if (appliesToCategory && higher) {
      return { max: hq.max, concession: 'higher qualification (footnote #)' };
    }
  }
  const base = baseMaxFor(rule, profile.category);
  let best: MaxResolution = { max: base, concession: null };
  if (base === null) return best; // "No maximum age limit"

  const candidates: Array<{ max: number | null; blocked?: string; applied?: string }> = [];

  if (profile.pwd) {
    const r = applyConcession(base, rule.concessions.pwd, 'PwBD', profile.category);
    if (r.blocked) return { max: base, concession: null, blocked: r.blocked };
    candidates.push(r);
  }
  if (profile.exServicemen) {
    candidates.push(applyConcession(base, rule.concessions.exServicemen, 'Ex-servicemen', profile.category));
  }
  if (profile.destituteWidow) {
    candidates.push(applyConcession(base, rule.concessions.destituteWidow, 'Destitute widow', profile.category));
  }

  for (const c of candidates) {
    if (c.max !== null && (best.max === null || c.max > best.max)) {
      best = { max: c.max, concession: c.applied ?? null };
    }
  }
  return best;
}

function ageCriterion(rule: AgeRule, profile: Profile, url?: string): { criterion: Criterion; outcome: RuleOutcome } {
  const age = ageOn(profile.dob, rule.cutoff).completedYears;
  const resolved = resolveMaxAge(rule, profile);
  const src = sourceOf(rule.citation, url);
  const label = rule.label;

  let status: CheckStatus = 'pass';
  let detail = '';

  if (resolved.blocked) {
    status = 'fail';
    detail = resolved.blocked;
  } else if (age < rule.minAge) {
    status = 'fail';
    const turns = birthdayFor(profile.dob, rule.minAge);
    detail = `You are ${age} on ${formatDate(rule.cutoff)}. Minimum age is ${rule.minAge}; you turn ${rule.minAge} on ${formatDate(turns)}.`;
  } else if (resolved.max === null) {
    detail = `You are ${age} on ${formatDate(rule.cutoff)}. No upper age limit for this post.`;
  } else if (age >= resolved.max) {
    status = 'fail';
    detail = `You are ${age} on ${formatDate(rule.cutoff)}; the limit is ${resolved.max} — you must not have completed ${resolved.max} years.`;
  } else {
    const headroom = resolved.max - age;
    detail = `You are ${age} on ${formatDate(rule.cutoff)}; limit is ${resolved.max}${
      resolved.concession ? ` (${resolved.concession})` : ''
    }. ${headroom <= 1 ? 'You are at the edge of the limit.' : `${headroom} years of headroom.`}`;
  }

  return {
    criterion: {
      id: `age-${rule.id}`,
      label: `Age — ${label}`,
      status,
      detail,
      source: src,
    },
    outcome: {
      ruleId: rule.id,
      label,
      postNames: rule.appliesTo.postNames,
      ageStatus: status,
      minAge: rule.minAge,
      maxAge: resolved.max,
      ageAtCutoff: age,
      concession: resolved.concession,
      detail,
    },
  };
}

function qualificationCriterion(
  rules: QualificationRule[],
  profile: Profile,
  url?: string,
): { criteria: Criterion[]; status: CheckStatus; blocking: boolean } {
  if (!rules.length) return { criteria: [], status: 'pass', blocking: false };

  const userRank = QUALIFICATION_RANK[profile.qualification];
  const criteria: Criterion[] = [];
  let best: CheckStatus = 'fail';
  let anyFieldSpecific = false;

  for (const r of rules) {
    const rank = QUALIFICATION_RANK[r.minLevel];
    const passes = userRank >= rank;
    const src = sourceOf(r.citation, url);
    let status: CheckStatus = passes ? 'pass' : 'fail';
    let detail = passes
      ? `Your highest qualification (${QUALIFICATION_LABELS[profile.qualification]}) meets the stated minimum.`
      : `Requires ${QUALIFICATION_LABELS[r.minLevel]} or above — you selected ${QUALIFICATION_LABELS[profile.qualification]}.`;

    if (passes && r.fieldSpecific) {
      status = 'unknown';
      anyFieldSpecific = true;
      detail = `${detail} The exact subject/degree matters here — check the notification before you apply.`;
    }
    const postLabel = r.postNames.length ? ` (${r.postNames.slice(0, 3).join(', ')}${r.postNames.length > 3 ? '…' : ''})` : '';
    criteria.push({
      id: `qual-${r.minLevel}-${criteria.length}`,
      label: `Education — ${r.summary}${postLabel}`,
      status,
      detail,
      source: src,
    });
  }

  // The candidate only needs to meet one of the listed qualification routes.
  const passes = criteria.some((c) => c.status === 'pass' || c.status === 'unknown');
  best = passes ? (anyFieldSpecific && !criteria.some((c) => c.status === 'pass') ? 'unknown' : 'pass') : 'fail';
  return { criteria, status: best, blocking: !passes };
}

function evaluateSpecial(
  req: SpecialRequirement,
  profile: Profile,
  url?: string,
): Criterion | null {
  const src = req.citation ? sourceOf(req.citation, url) : undefined;
  switch (req.autoCheck) {
    case 'female-only':
      if (profile.gender === 'male') {
        return { id: req.id, label: req.label, status: 'fail', detail: req.detail, source: src };
      }
      return { id: req.id, label: req.label, status: 'pass', detail: 'Open to your gender.', source: src };
    case 'tamil-sslc':
      if (!profile.tamilSslc) {
        return {
          id: req.id,
          label: req.label,
          status: 'unknown',
          detail: `${req.detail} You indicated you did not study Tamil at SSLC level; the Second Class Language Test route may still apply.`,
          source: src,
        };
      }
      return { id: req.id, label: req.label, status: 'pass', detail: 'Tamil at SSLC level satisfies this requirement.', source: src };
    case 'no-pwd':
      if (profile.pwd) return { id: req.id, label: req.label, status: 'fail', detail: req.detail, source: src };
      return { id: req.id, label: req.label, status: 'pass', detail: 'Not applicable to you.', source: src };
    case 'physical-standards':
      return { id: req.id, label: req.label, status: 'info', detail: req.detail, source: src };
    case 'serving-teacher':
      if (!profile.servingTeacher) {
        return { id: req.id, label: req.label, status: 'fail', detail: req.detail, source: src };
      }
      return { id: req.id, label: req.label, status: 'pass', detail: 'You indicated you are a serving teacher.', source: src };
    case 'tn-resident':
      return { id: req.id, label: req.label, status: 'pass', detail: `${req.detail} (Reservation is claimed with the TN community certificate.)`, source: src };
    default:
      return {
        id: req.id,
        label: req.label,
        status: req.severity === 'blocking' ? 'unknown' : 'info',
        detail: req.severity === 'blocking' ? `${req.detail} This condition is not automated — check it yourself.` : req.detail,
        source: src,
      };
  }
}

/** Evaluate one exam against one candidate profile. Pure and deterministic. */
export function evaluateExam(exam: Exam, profile: Profile): ExamVerdict {
  const url = exam.officialLinks.notification;
  const cutoff = exam.ageRules[0]?.cutoff ?? exam.dates.cutoffAgeDate ?? '';
  const ageAtCutoff = cutoff ? ageOn(profile.dob, cutoff).completedYears : 0;

  const applicable = exam.ageRules.filter(
    (r) => r.appliesTo.gender === 'any' || r.appliesTo.gender === profile.gender,
  );
  const genderBarred = exam.ageRules.some((r) => r.appliesTo.gender !== 'any') && applicable.length === 0;

  const ruleOutcomes: RuleOutcome[] = [];
  const criteria: Criterion[] = [];
  const applied = new Set<string>();
  let effectiveMax: number | null = null;
  /** No rules transcribed and no explicit "no age limit" statement. */
  const rulesUnknown = exam.hasAgeLimit !== false && exam.ageRules.length === 0;
  let agePass = exam.hasAgeLimit === false;

  for (const rule of applicable) {
    const { criterion, outcome } = ageCriterion(rule, profile, url);
    criteria.push(criterion);
    ruleOutcomes.push(outcome);
    if (outcome.maxAge !== null) {
      effectiveMax = effectiveMax === null ? outcome.maxAge : Math.max(effectiveMax, outcome.maxAge);
    }
    if (outcome.ageStatus === 'pass') agePass = true;
    if (outcome.concession) applied.add(outcome.concession);
  }

  if (rulesUnknown) {
    criteria.unshift({
      id: 'age-unverified',
      label: 'Age',
      status: 'unknown',
      detail:
        'The age conditions of this notification have not been transcribed and verified yet, so ExamLens does not give an eligibility answer for it.',
      source: { url: exam.officialLinks.notification },
    });
  }

  if (exam.hasAgeLimit === false) {
    criteria.unshift({
      id: 'age-none',
      label: 'Age',
      status: 'pass',
      detail: 'This notification prescribes no age limit.',
      source: { url: exam.officialLinks.notification },
    });
  }

  if (genderBarred) {
    criteria.unshift({
      id: 'gender-barred',
      label: 'Gender',
      status: 'fail',
      detail: 'This recruitment is restricted by gender in the notification.',
    });
  }

  const qual = qualificationCriterion(exam.qualifications, profile, url);
  criteria.push(...qual.criteria);

  const blockingSpecial: string[] = [];
  let blockingSpecialUnknown = false;
  for (const req of exam.specialRequirements) {
    const c = evaluateSpecial(req, profile, url);
    if (!c) continue;
    criteria.push(c);
    if (c.status === 'fail' && req.severity === 'blocking') blockingSpecial.push(c.detail);
    if (c.status === 'unknown' && req.severity === 'blocking') blockingSpecialUnknown = true;
  }

  const blockers: string[] = [];
  if (genderBarred) blockers.push('This recruitment is restricted by gender.');
  if (!agePass && !genderBarred && !rulesUnknown) {
    const failed = ruleOutcomes.filter((r) => r.ageStatus === 'fail').map((r) => r.detail);
    blockers.push(...(failed.length ? failed : ['Age could not be verified.']));
  }
  if (qual.blocking) blockers.push(...qual.criteria.filter((c) => c.status === 'fail').map((c) => c.detail));
  blockers.push(...blockingSpecial);

  let status: Verdict;
  if (rulesUnknown) status = 'needs_check';
  else if (blockers.length) status = 'ineligible';
  else if (qual.status === 'unknown' || blockingSpecialUnknown) status = 'needs_check';
  else if (exam.ageRules.length > 1 && ruleOutcomes.some((r) => r.ageStatus === 'fail')) status = 'partial';
  else status = 'eligible';

  const headline =
    status === 'eligible'
      ? 'You can apply'
      : status === 'partial'
        ? 'You can apply for some posts'
        : status === 'needs_check'
          ? 'Likely eligible — verify one detail'
          : 'You cannot apply';

  let nearMiss: string | null = null;
  if (status === 'ineligible' && !genderBarred) {
    const generalRule = exam.ageRules[0];
    const generalMax = generalRule ? baseMaxFor(generalRule, 'general') : null;
    if (
      generalMax !== null &&
      RELAXED_CATEGORIES.includes(profile.category) === false &&
      RELAXED_CATEGORIES.length > 0
    ) {
      const relaxedRule = exam.ageRules[0];
      const relaxedMax = relaxedRule ? baseMaxFor(relaxedRule, 'sc') : null;
      if (relaxedMax !== null && effectiveMax !== null && ageAtCutoff < relaxedMax && ageAtCutoff >= (effectiveMax ?? Infinity)) {
        nearMiss = `Under the reserved-category limit of ${relaxedMax} you would be inside the age window — the ${CATEGORY_LABELS[profile.category]} limit for this post is ${effectiveMax}.`;
      }
    }
    if (!nearMiss && qual.blocking) {
      const needed = exam.qualifications[0];
      if (needed) nearMiss = `The only gap is education: this exam needs ${needed.summary}.`;
    }
  }

  return {
    examId: exam.id,
    examName: exam.name,
    shortName: exam.shortName,
    slug: exam.slug,
    status,
    headline,
    ageAtCutoff,
    cutoff,
    effectiveMaxAge: effectiveMax,
    appliedConcessions: [...applied],
    criteria,
    rules: ruleOutcomes,
    blockers,
    nearMiss,
  };
}

export function evaluateAll(exams: Exam[], profile: Profile): ExamVerdict[] {
  return exams.map((e) => evaluateExam(e, profile));
}

/** Sort so the most actionable exams surface first. */
export function rankVerdicts(verdicts: ExamVerdict[], exams: Exam[]): ExamVerdict[] {
  const order: Record<Verdict, number> = { eligible: 0, needs_check: 1, partial: 2, ineligible: 3 };
  const byId = new Map(exams.map((e) => [e.id, e]));
  return [...verdicts].sort((a, b) => {
    const d = order[a.status] - order[b.status];
    if (d !== 0) return d;
    const ea = byId.get(a.examId);
    const eb = byId.get(b.examId);
    return (ea?.dates.applyEnd ?? '9999').localeCompare(eb?.dates.applyEnd ?? '9999');
  });
}
