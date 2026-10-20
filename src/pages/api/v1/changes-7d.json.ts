import type { APIRoute } from 'astro';
import { getDataset } from '../../../lib/server/data';
import { datasetMeta, jsonResponse } from '../../../lib/server/public';

export const GET: APIRoute = ({ site }) => {
  const base = site ?? new URL('https://examlens.pages.dev');
  const ds = getDataset();
  const cutoff = Date.now() - 7 * 86400000;
  const recent = ds.changes.filter((c) => Date.parse(c.effectiveAt ?? c.detectedAt) >= cutoff);
  return jsonResponse({
    generatedAt: ds.generatedAt,
    schemaVersion: datasetMeta(base).schemaVersion,
    window: 'P7D',
    count: recent.length,
    changes: recent,
  });
};
