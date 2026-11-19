/**
 * gen-sample.mjs — writes data/incidents.sample.json from the mock generator.
 *
 * The file exists so the HTTP adapter has something realistic to point at
 * without standing up a backend. Timestamps are anchored to the moment you
 * generate it, so re-run this when the sample starts looking stale:
 *
 *   npm run gen:sample
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { buildMockIncidents, buildFlowSamples } from '../js/data/mockFeed.js';
import { normalizeFeed } from '../js/data/incident.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const outPath = resolve(root, 'data/incidents.sample.json');

const now = Date.now();

const incidentsRaw = buildMockIncidents({ now });

// Flow samples need normalized incidents to shape congestion around them.
const { incidents } = normalizeFeed(incidentsRaw, { now, source: 'sample' });
const flow = buildFlowSamples({ now, incidents });

const payload = {
  generatedAt: new Date(now).toISOString(),
  note:
    'Synthetic data for the incident-overlay prototype. Regenerate with ' +
    '`npm run gen:sample`. Road geometry is hand-approximated, not survey-grade.',
  incidents: incidentsRaw,
  flow,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

console.log(
  `wrote ${outPath}\n  ${incidentsRaw.length} incidents, ${flow.length} flow samples` +
  `\n  anchored to ${payload.generatedAt}`,
);
