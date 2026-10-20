import type { APIRoute } from 'astro';
import { getDataset } from '../lib/server/data';
import { buildCalendar } from '../lib/presentation';

export const GET: APIRoute = () => {
  const ds = getDataset();
  return new Response(buildCalendar(ds.exams), {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'inline; filename="examlens-tn-deadlines.ics"',
      'cache-control': 'public, max-age=3600',
    },
  });
};
