#!/usr/bin/env tsx
/**
 * Scaffold a curated exam record.
 *
 *   pnpm new:exam tnpsc-group-3-2026
 *
 * The skeleton is intentionally invalid until you fill it in: the validator
 * refuses placeholder quotes, so an unfinished record can never ship.
 */
import { writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const id = process.argv[2];
if (!id || !/^[a-z0-9-]+$/.test(id)) {
  console.error('Usage: pnpm new:exam <id-in-kebab-case>');
  process.exit(1);
}

const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'curated', 'exams', `${id}.json`);
if (existsSync(file)) {
  console.error(`✗ ${file} already exists`);
  process.exit(1);
}

const year = Number(id.match(/(\d{4})$/)?.[1] ?? new Date().getFullYear());
const skeleton = {
  id,
  board: 'tnpsc',
  boardName: 'Tamil Nadu Public Service Commission',
  name: 'REPLACE — full notification title',
  shortName: 'REPLACE — short label',
  notificationNo: 'REPLACE — e.g. 09/2026',
  slug: id,
  year,
  status: 'open',
  level: 'other',
  summary: 'REPLACE — two sentences on what this recruitment is, in your own words.',
  whyItMatters: 'REPLACE — what makes this notification worth a page.',
  dates: {
    notification: null,
    applyStart: null,
    applyEnd: null,
    examDate: null,
    resultDate: null,
    cutoffAgeDate: null,
  },
  vacancies: { total: null, breakdown: [] },
  fee: { amount: null },
  hasAgeLimit: true,
  ageRules: [
    {
      id: 'main',
      label: 'All posts',
      appliesTo: { postCodes: [], postNames: [], gender: 'any' },
      cutoff: '2026-07-01',
      minAge: 18,
      maxAge: { general: 32, bc: 37, bcm: 37, mbc_dc: 37, sc: 37, sca: 37, st: 37 },
      concessions: { pwd: null, exServicemen: null, destituteWidow: null },
      citation: {
        quote: 'PASTE A SENTENCE EXACTLY AS PRINTED IN THE PDF',
        page: 1,
        values: [18, 32, 37],
      },
    },
  ],
  qualifications: [],
  specialRequirements: [],
  selectionProcess: [],
  officialLinks: {
    notification: 'https://tnpsc.gov.in/REPLACE.pdf',
    apply: 'https://apply.tnpscexams.in/secure?app_id=UElZMDAwMDAwMQ==',
    board: 'https://tnpsc.gov.in/',
    syllabus: null,
  },
  sources: [
    {
      id: 'notification',
      authority: 'Tamil Nadu Public Service Commission',
      title: 'REPLACE',
      url: 'https://tnpsc.gov.in/REPLACE.pdf',
      kind: 'pdf',
      language: 'en',
    },
  ],
  maintenance: 'verified',
};

writeFileSync(file, `${JSON.stringify(skeleton, null, 2)}\n`, 'utf8');
console.log(`Created ${file}`);
console.log('\nNext:');
console.log('  1. paste the exact age / qualification sentences, with page numbers and table values');
console.log('  2. pnpm refresh   (downloads the PDF and checks each quote)');
console.log('  3. pnpm validate  (fails loudly if anything does not match)');
