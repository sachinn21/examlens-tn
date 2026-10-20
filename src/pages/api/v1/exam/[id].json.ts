import type { APIRoute } from 'astro';
import { getDataset } from '../../../../lib/server/data';
import { SCHEMA_VERSION, jsonResponse, publicExam } from '../../../../lib/server/public';

export const GET: APIRoute = ({ params, site }) => {
  const base = site ?? new URL('https://examlens.pages.dev');
  const ds = getDataset();
  const exam = ds.exams.find((e) => e.id === params.id || e.slug === params.id);
  if (!exam) {
    return new Response(JSON.stringify({ error: 'not_found', id: params.id, schemaVersion: SCHEMA_VERSION }), {
      status: 404,
      headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' },
    });
  }
  return jsonResponse({ schemaVersion: SCHEMA_VERSION, exam: publicExam(exam, base) });
};

export function getStaticPaths() {
  return getDataset().exams.map((e) => ({ params: { id: e.id } }));
}
