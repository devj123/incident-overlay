/**
 * flowLayer.js — colour-coded traffic speed segments.
 *
 * Rendered on a Canvas renderer: there can be thousands of these on a real
 * network and one SVG path per segment does not scale. Canvas gives up CSS
 * styling and per-element DOM, which is fine here because flow segments are
 * non-interactive decoration.
 *
 * @typedef {import('../data/sources.js')} _
 */

import { FLOW } from '../config.js';

/**
 * @param {{ map: any, pane?: string }} opts
 */
export function createFlowLayer({ map, pane }) {
  const renderer = L.canvas({ padding: 0.3, pane });
  const group = L.layerGroup([], { pane });

  /** @type {Map<string, any>} keyed by `${corridorId}:${index}` */
  const polylines = new Map();
  let visible = true;

  function keyOf(sample) {
    return `${sample.corridorId}:${sample.index}`;
  }

  function styleFor(sample) {
    const spec = FLOW[sample.flow] ?? FLOW.unknown;
    return {
      color: spec.color,
      weight: spec.weight,
      opacity: 0.9,
      lineCap: 'round',
      lineJoin: 'round',
      interactive: false,
      renderer,
      pane,
    };
  }

  /**
   * Reconcile the layer against a new set of samples.
   * Existing polylines are restyled in place rather than torn down, which
   * avoids a full canvas rebuild on every poll.
   * @param {{corridorId:string,index:number,path:[number,number][],flow:string}[]} samples
   */
  function update(samples) {
    const seen = new Set();

    for (const sample of samples || []) {
      if (!Array.isArray(sample.path) || sample.path.length < 2) continue;
      const key = keyOf(sample);
      seen.add(key);

      const existing = polylines.get(key);
      if (existing) {
        existing.setStyle(styleFor(sample));
        existing.setLatLngs(sample.path);
      } else {
        const line = L.polyline(sample.path, styleFor(sample));
        polylines.set(key, line);
        group.addLayer(line);
      }
    }

    // Drop segments that vanished from the feed.
    for (const [key, line] of polylines) {
      if (!seen.has(key)) {
        group.removeLayer(line);
        polylines.delete(key);
      }
    }
  }

  function setVisible(next) {
    if (next === visible) return;
    visible = next;
    if (next) group.addTo(map);
    else map.removeLayer(group);
  }

  function destroy() {
    group.clearLayers();
    polylines.clear();
    if (map.hasLayer(group)) map.removeLayer(group);
  }

  group.addTo(map);

  return { update, setVisible, destroy, get visible() { return visible; }, group };
}
