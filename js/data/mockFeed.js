/**
 * mockFeed.js — synthetic feed records for the demo.
 *
 * These are *raw* records in a deliberately slightly-messy shape (mixed key
 * casing, string numbers, an ISO date here and an epoch there) so that the
 * normalizer in incident.js is genuinely exercised rather than bypassed.
 *
 * Timestamps are generated relative to a supplied `now`, so the demo always
 * looks live regardless of when it is opened.
 */

import { CORRIDORS, getCorridor } from './roads.js';
import { sliceLine } from '../util/geo.js';
import { MS } from '../util/time.js';

/** Pull a sub-segment of a named corridor, by fraction along its length. */
function seg(corridorId, from, to) {
  const corridor = getCorridor(corridorId);
  if (!corridor) return [];
  return sliceLine(corridor.path, from, to);
}

/**
 * Build the raw incident feed.
 * @param {{ now?: number, includeMalformed?: boolean }} [opts]
 * @returns {object[]} raw records
 */
export function buildMockIncidents(opts = {}) {
  const now = opts.now ?? Date.now();
  const records = [
    /* ---- the headline event: injury collision blocking SR 520 EB ------- */
    {
      id: 'INC-2201',
      type: 'collision',
      severity: 'high',
      // status intentionally omitted → derived from the time window
      headline: 'Two-vehicle collision blocking two right lanes',
      description:
        'Injury collision reported in the eastbound lanes near milepost 6.4. ' +
        'Two of three lanes are blocked; the left lane is getting by. ' +
        'Expect residual delay through the 148th Ave NE interchange.',
      road: { name: 'SR 520', direction: 'Eastbound', mpStart: 6.4, mpEnd: 7.1 },
      geometry: seg('sr520', 0.42, 0.62),
      lanes: { total: 3, blocked: 2, note: '2 of 3 lanes blocked' },
      startTime: new Date(now - 41 * MS.minute).toISOString(),
      estimatedClearTime: new Date(now + 24 * MS.minute).toISOString(),
      lastUpdated: now - 6 * MS.minute,
      reportedBy: 'State Patrol',
    },

    /* ---- overnight paving, still in the future ------------------------- */
    {
      id: 'INC-2202',
      type: 'roadwork',                    // alias → construction
      severity: 'moderate',                // alias → medium
      headline: 'Overnight paving, single-lane closures',
      description:
        'Alternating single-lane closures for paving between Redmond Way and ' +
        'the Sammamish River bridge. Flaggers on site.',
      road: { name: 'SR 202', direction: 'Both directions', mpStart: 1.2, mpEnd: 2.8 },
      geometry: seg('sr202', 0.15, 0.7),
      lanes: { total: 2, blocked: 1 },
      startTime: now + 3.2 * MS.hour,
      endTime: now + 9.5 * MS.hour,
      lastUpdated: now - 2 * MS.hour,
      reportedBy: 'Regional Maintenance',
    },

    /* ---- full closure (black marker) ----------------------------------- */
    {
      id: 'INC-2203',
      type: 'closure',
      severity: 'closure',
      headline: 'Avondale Rd NE closed for emergency water main repair',
      description:
        'Full closure in both directions between NE 85th St and NE 95th St. ' +
        'Local access only. Signed detour via 172nd Ave NE.',
      road: { name: 'Avondale Rd NE', direction: 'Both directions' },
      geometry: seg('avondale', 0.3, 0.85),
      lanes: { total: 2, blocked: 2, note: 'Road fully closed' },
      startTime: now - 3.1 * MS.hour,
      estimatedClearTime: now + 5 * MS.hour,
      lastUpdated: now - 34 * MS.minute,
      reportedBy: 'City of Redmond',
    },

    /* ---- low-severity debris, point geometry only ---------------------- */
    {
      id: 'INC-2204',
      type: 'debris',                      // alias → hazard
      severity: 1,                         // numeric rank → low
      headline: 'Debris in the right shoulder',
      description: 'Ladder reported in the northbound shoulder near NE 60th St.',
      road: { name: '148th Ave NE', direction: 'Northbound', mpStart: 3.1 },
      lat: 47.6534,
      lng: -122.1458,
      lanes: { blocked: 0, note: 'Shoulder only' },
      startTime: now - 18 * MS.minute,
      lastUpdated: now - 18 * MS.minute,
      reportedBy: 'Traffic Management Center',
    },

    /* ---- already cleared — exercises the scrubber ---------------------- */
    {
      id: 'INC-2205',
      type: 'disabled vehicle',
      severity: 'minor',
      status: 'cleared',
      headline: 'Disabled vehicle cleared',
      description: 'Disabled box truck removed from the right lane.',
      road: { name: 'SR 520', direction: 'Westbound', mpStart: 8.2 },
      geometry: seg('sr520', 0.74, 0.8),
      lanes: { total: 3, blocked: 1 },
      startTime: now - 2.6 * MS.hour,
      endTime: now - 96 * MS.minute,
      lastUpdated: now - 96 * MS.minute,
      reportedBy: 'Incident Response Team',
    },

    /* ---- medium collision on an arterial ------------------------------- */
    {
      id: 'INC-2206',
      type: 'crash',
      severity: 'medium',
      headline: 'Collision blocking the southbound left turn lane',
      description: 'Non-injury collision at the NE 40th St intersection.',
      road: { name: 'W Lake Sammamish Pkwy NE', direction: 'Southbound' },
      geometry: seg('wlsp', 0.45, 0.6),
      lanes: { total: 2, blocked: 1 },
      startTime: now - 52 * MS.minute,
      estimatedClearTime: now + 8 * MS.minute,
      lastUpdated: now - 11 * MS.minute,
      reportedBy: 'City of Redmond',
    },

    /* ---- scheduled special event --------------------------------------- */
    {
      id: 'INC-2207',
      type: 'special event',
      severity: 'low',
      headline: 'Rolling closures for a charity ride',
      description: 'Intermittent rolling closures on Willows Rd NE, 8:00–11:00.',
      road: { name: 'Willows Rd NE', direction: 'Northbound' },
      geometry: seg('willows', 0.1, 0.9),
      lanes: { total: 2, blocked: 1 },
      startTime: now + 55 * MS.minute,
      endTime: now + 3.9 * MS.hour,
      lastUpdated: now - 5 * MS.hour,
      reportedBy: 'City of Redmond',
    },
  ];

  if (opts.includeMalformed) {
    // Two records the normalizer should reject cleanly, plus one it should
    // repair with a warning. Useful for demoing the validation path.
    records.push(
      { type: 'collision', headline: 'No id at all' },
      { id: 'INC-BAD-1', type: 'collision', headline: 'No location, no geometry', startTime: now },
      {
        id: 'INC-BAD-2',
        type: 'meteor strike',
        severity: 'catastrophic',
        headline: 'Unknown vocabulary, out-of-range geometry',
        road: { name: 'SR 520' },
        geometry: [[47.66, -122.14], [999, -122.13], [47.665, -122.12]],
        lanes: { total: 2, blocked: 7 },
        startTime: now - 10 * MS.minute,
        endTime: now - 40 * MS.minute,     // end before start → dropped
      },
    );
  }

  return records;
}

/* ------------------------------------------------------------------------ */
/* Traffic-flow samples                                                      */
/* ------------------------------------------------------------------------ */

/**
 * Deterministic pseudo-random in [0,1) from an integer seed — so the demo
 * looks the same on every reload instead of flickering.
 */
function seeded(n) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Build per-segment speed samples for every corridor.
 *
 * Congestion is shaped around active incidents: speeds drop sharply just
 * upstream of an incident and recover downstream, which is what actually
 * happens and makes the overlay legible.
 *
 * @param {{ now?: number, incidents?: import('./incident.js').Incident[] }} [opts]
 * @returns {{corridorId:string, index:number, path:[number,number][],
 *            freeFlowMph:number, currentMph:number}[]}
 */
export function buildFlowSamples(opts = {}) {
  const incidents = opts.incidents ?? [];
  const samples = [];

  // Which corridors have an active incident, and where along them.
  const hotspots = new Map();
  for (const inc of incidents) {
    if (inc.status !== 'active') continue;
    const corridor = CORRIDORS.find(
      (c) => c.name === inc.road.name || c.shortName === inc.road.name,
    );
    if (!corridor || inc.geometry.length === 0) continue;

    // Approximate the incident's position as a fraction along the corridor by
    // matching its first geometry vertex to the nearest corridor vertex.
    let bestIdx = 0;
    let bestDist = Infinity;
    const [ilat, ilng] = inc.geometry[0];
    corridor.path.forEach((pt, i) => {
      const d = (pt[0] - ilat) ** 2 + (pt[1] - ilng) ** 2;
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    });

    const severityFactor = { low: 0.15, medium: 0.4, high: 0.75, closure: 1 }[inc.severity] ?? 0.4;
    const existing = hotspots.get(corridor.id);
    if (!existing || severityFactor > existing.factor) {
      hotspots.set(corridor.id, { index: bestIdx, factor: severityFactor });
    }
  }

  let seed = 1;
  for (const corridor of CORRIDORS) {
    const hotspot = hotspots.get(corridor.id);

    for (let i = 1; i < corridor.path.length; i += 1) {
      seed += 1;
      const a = corridor.path[i - 1];
      const b = corridor.path[i];

      // Baseline: mild variation around free-flow.
      let ratio = 0.86 + seeded(seed) * 0.14;

      if (hotspot) {
        // Distance in vertices from the incident; negative = upstream.
        const offset = (i - 1) - hotspot.index;
        if (offset >= -3 && offset <= 0) {
          // Queue builds upstream, worst right at the incident.
          const proximity = 1 - Math.abs(offset) / 4;
          ratio -= hotspot.factor * 0.82 * proximity;
        } else if (offset > 0 && offset <= 2) {
          // Downstream of the blockage traffic is unusually free.
          ratio = Math.min(1.02, ratio + 0.08);
        }
      }

      ratio = Math.max(0.06, Math.min(1.05, ratio));

      samples.push({
        corridorId: corridor.id,
        index: i - 1,
        path: [a, b],
        freeFlowMph: corridor.freeFlowMph,
        currentMph: Math.round(corridor.freeFlowMph * ratio),
      });
    }
  }

  return samples;
}
