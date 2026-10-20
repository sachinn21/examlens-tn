import type { APIRoute } from 'astro';
import { getDataset } from '../../../lib/server/data';
import { datasetMeta, jsonResponse } from '../../../lib/server/public';

export const GET: APIRoute = ({ site }) => {
  const base = site ?? new URL('https://examlens.pages.dev');
  const ds = getDataset();
  return jsonResponse({
    ...datasetMeta(base),
    freshness: ds.freshness,
    announcements: ds.announced,
  });
};
