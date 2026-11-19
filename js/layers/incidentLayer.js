/**
 * incidentLayer.js — incident geometry + severity markers.
 *
 * Rendering model per incident:
 *
 *   casing   wide, dark, low-opacity polyline    → separates the overlay from
 *                                                  whatever colour the basemap
 *                                                  painted underneath
 *   core     severity-coloured polyline          → the actual signal
 *   dash     marching-ants overlay (active only) → conveys "this is live"
 *   marker   DivIcon badge at the anchor point   → hit target + legend tie-in
 *
 * Uses the SVG renderer (not canvas) because these need CSS classes for the
 * dash animation and hover transitions, and because there are tens of them,
 * not thousands.
 */

import { SEVERITY, SEGMENT_STYLE, MARKER_SIZE, INCIDENT_TYPES } from '../config.js';
import { glyphForType, markerHtml } from './icons.js';
import { statusAt } from '../data/incident.js';

/**
 * @param {{
 *   map: any,
 *   segmentPane?: string,
 *   markerPane?: string,
 *   onSelect?: (id:string|null)=>void,
 *   onHover?: (id:string|null)=>void,
 *   typedGlyphs?: boolean,
 * }} opts
 */
export function createIncidentLayer({
  map,
  segmentPane,
  markerPane,
  onSelect,
  onHover,
  typedGlyphs = true,
}) {
  const renderer = L.svg({ padding: 0.4, pane: segmentPane });

  const segmentGroup = L.layerGroup([], { pane: segmentPane });
  const markerGroup = L.layerGroup([], { pane: markerPane });

  /**
   * @type {Map<string, {
   *   incident: any, casing: any|null, core: any|null, dash: any|null, marker: any
   * }>}
   */
  const entries = new Map();

  let selectedId = null;
  let hoveredId = null;
  let visible = true;
  let currentTime = Date.now();

  /* ------------------------------------------------------------- styles -- */

  function severitySpec(incident) {
    return SEVERITY[incident.severity] ?? SEVERITY.medium;
  }

  function isEmphasised(id) {
    return id === selectedId || id === hoveredId;
  }

  function coreStyle(incident) {
    const spec = severitySpec(incident);
    const live = statusAt(incident, currentTime) === 'active';
    const extra = isEmphasised(incident.id) ? SEGMENT_STYLE.selectedExtra : 0;
    return {
      color: spec.color,
      weight: spec.weight + extra,
      opacity: live ? SEGMENT_STYLE.coreOpacity : 0.45,
      lineCap: 'round',
      lineJoin: 'round',
    };
  }

  function casingStyle(incident) {
    const spec = severitySpec(incident);
    const extra = isEmphasised(incident.id) ? SEGMENT_STYLE.selectedExtra : 0;
    return {
      color: SEGMENT_STYLE.casingColor,
      weight: spec.weight + SEGMENT_STYLE.casingExtra + extra,
      opacity: SEGMENT_STYLE.casingOpacity,
      lineCap: 'round',
      lineJoin: 'round',
    };
  }

  function dashStyle(incident) {
    const spec = severitySpec(incident);
    return {
      color: '#ffffff',
      weight: Math.max(1.6, spec.weight - 3.4),
      opacity: 0.75,
      dashArray: SEGMENT_STYLE.dashArray,
      lineCap: 'butt',
    };
  }

  function markerIcon(incident) {
    const spec = severitySpec(incident);
    const size = MARKER_SIZE[incident.severity] ?? 24;
    const live = statusAt(incident, currentTime) === 'active';
    const pulse = live && (incident.severity === 'high' || incident.severity === 'closure');

    return L.divIcon({
      className: `inc-marker inc-marker--${incident.severity}` +
        (incident.id === selectedId ? ' inc-marker--selected' : ''),
      html: markerHtml({
        color: spec.color,
        glyph: glyphForType(incident.type, { typed: typedGlyphs }),
        pulse,
      }),
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      popupAnchor: [0, -size / 2],
    });
  }

  function markerLabel(incident) {
    const typeLabel = INCIDENT_TYPES[incident.type]?.label ?? 'Incident';
    const dir = incident.road.direction ? ` ${incident.road.direction}` : '';
    return `${severitySpec(incident).label} severity ${typeLabel} on ${incident.road.name}${dir}`;
  }

  /* --------------------------------------------------------------- build -- */

  function attachHandlers(layer, id) {
    layer.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      onSelect?.(id);
    });
    layer.on('mouseover', () => setHovered(id));
    layer.on('mouseout', () => setHovered(null));
  }

  function createEntry(incident) {
    const hasLine = incident.geometry.length >= 2;

    const casing = hasLine
      ? L.polyline(incident.geometry, {
          ...casingStyle(incident),
          renderer,
          pane: segmentPane,
          interactive: true,
          bubblingMouseEvents: false,
          className: 'inc-segment inc-segment--casing',
        })
      : null;

    const core = hasLine
      ? L.polyline(incident.geometry, {
          ...coreStyle(incident),
          renderer,
          pane: segmentPane,
          interactive: true,
          bubblingMouseEvents: false,
          className: 'inc-segment inc-segment--core',
        })
      : null;

    const live = statusAt(incident, currentTime) === 'active';
    const dash = hasLine && live
      ? L.polyline(incident.geometry, {
          ...dashStyle(incident),
          renderer,
          pane: segmentPane,
          interactive: false,
          className: 'inc-segment inc-segment--dash',
        })
      : null;

    const marker = L.marker(incident.location, {
      icon: markerIcon(incident),
      pane: markerPane,
      riseOnHover: true,
      keyboard: true,
      title: markerLabel(incident),
      zIndexOffset: severitySpec(incident).rank * 1000,
      alt: markerLabel(incident),
    });

    if (casing) { attachHandlers(casing, incident.id); segmentGroup.addLayer(casing); }
    if (core) { attachHandlers(core, incident.id); segmentGroup.addLayer(core); }
    if (dash) segmentGroup.addLayer(dash);

    attachHandlers(marker, incident.id);
    marker.on('keypress', (e) => {
      const key = e.originalEvent?.key;
      if (key === 'Enter' || key === ' ') {
        L.DomEvent.stop(e);
        onSelect?.(incident.id);
      }
    });
    markerGroup.addLayer(marker);

    // DivIcon markers are plain divs; give assistive tech something to read.
    const node = marker.getElement();
    if (node) {
      node.setAttribute('role', 'button');
      node.setAttribute('aria-label', markerLabel(incident));
    }

    return { incident, casing, core, dash, marker };
  }

  function updateEntry(entry, incident) {
    const geometryChanged =
      JSON.stringify(entry.incident.geometry) !== JSON.stringify(incident.geometry);
    entry.incident = incident;

    if (entry.casing) {
      if (geometryChanged) entry.casing.setLatLngs(incident.geometry);
      entry.casing.setStyle(casingStyle(incident));
    }
    if (entry.core) {
      if (geometryChanged) entry.core.setLatLngs(incident.geometry);
      entry.core.setStyle(coreStyle(incident));
    }

    const live = statusAt(incident, currentTime) === 'active';
    if (entry.dash && !live) {
      segmentGroup.removeLayer(entry.dash);
      entry.dash = null;
    } else if (!entry.dash && live && incident.geometry.length >= 2) {
      entry.dash = L.polyline(incident.geometry, {
        ...dashStyle(incident),
        renderer,
        pane: segmentPane,
        interactive: false,
        className: 'inc-segment inc-segment--dash',
      });
      segmentGroup.addLayer(entry.dash);
    } else if (entry.dash) {
      if (geometryChanged) entry.dash.setLatLngs(incident.geometry);
      entry.dash.setStyle(dashStyle(incident));
    }

    entry.marker.setLatLng(incident.location);
    entry.marker.setIcon(markerIcon(incident));
    entry.marker.setZIndexOffset(severitySpec(incident).rank * 1000);

    const node = entry.marker.getElement();
    if (node) {
      node.setAttribute('role', 'button');
      node.setAttribute('aria-label', markerLabel(incident));
    }
  }

  function removeEntry(entry) {
    if (entry.casing) segmentGroup.removeLayer(entry.casing);
    if (entry.core) segmentGroup.removeLayer(entry.core);
    if (entry.dash) segmentGroup.removeLayer(entry.dash);
    markerGroup.removeLayer(entry.marker);
  }

  /* ---------------------------------------------------------------- API --- */

  /**
   * Reconcile against a new incident list. Incidents are matched by id so that
   * markers keep their DOM node (and therefore hover/focus) across polls.
   * @param {any[]} incidents
   * @param {{ at?: number }} [opts]
   */
  function update(incidents, opts = {}) {
    if (opts.at !== undefined) currentTime = opts.at;

    const seen = new Set();
    for (const incident of incidents || []) {
      seen.add(incident.id);
      const existing = entries.get(incident.id);
      if (existing) updateEntry(existing, incident);
      else entries.set(incident.id, createEntry(incident));
    }

    for (const [id, entry] of entries) {
      if (!seen.has(id)) {
        removeEntry(entry);
        entries.delete(id);
      }
    }

    if (selectedId && !entries.has(selectedId)) {
      selectedId = null;
      onSelect?.(null);
    }
  }

  /** Restyle everything for a new evaluation instant (time scrubbing). */
  function setTime(t) {
    currentTime = t;
    for (const entry of entries.values()) updateEntry(entry, entry.incident);
  }

  function refreshStyles(ids) {
    const list = ids ?? Array.from(entries.keys());
    for (const id of list) {
      const entry = entries.get(id);
      if (entry) updateEntry(entry, entry.incident);
    }
  }

  function setSelected(id) {
    if (id === selectedId) return;
    const previous = selectedId;
    selectedId = id;
    refreshStyles([previous, id].filter(Boolean));
  }

  function setHovered(id) {
    if (id === hoveredId) return;
    const previous = hoveredId;
    hoveredId = id;
    refreshStyles([previous, id].filter(Boolean));
    onHover?.(id);
  }

  function setVisible(next) {
    if (next === visible) return;
    visible = next;
    if (next) {
      segmentGroup.addTo(map);
      markerGroup.addTo(map);
    } else {
      map.removeLayer(segmentGroup);
      map.removeLayer(markerGroup);
    }
  }

  /** Fit the map to one incident, or to all of them. */
  function focus(id, { padding = [70, 70], maxZoom = 15 } = {}) {
    const entry = entries.get(id);
    if (!entry) return false;

    const { incident } = entry;
    if (incident.geometry.length >= 2) {
      map.fitBounds(L.latLngBounds(incident.geometry), { padding, maxZoom });
    } else {
      map.setView(incident.location, Math.max(map.getZoom(), 15), { animate: true });
    }
    return true;
  }

  function fitAll({ padding = [60, 60], maxZoom = 14 } = {}) {
    const points = [];
    for (const { incident } of entries.values()) {
      points.push(incident.location);
      points.push(...incident.geometry);
    }
    if (points.length === 0) return false;
    map.fitBounds(L.latLngBounds(points), { padding, maxZoom });
    return true;
  }

  function destroy() {
    segmentGroup.clearLayers();
    markerGroup.clearLayers();
    entries.clear();
    if (map.hasLayer(segmentGroup)) map.removeLayer(segmentGroup);
    if (map.hasLayer(markerGroup)) map.removeLayer(markerGroup);
  }

  segmentGroup.addTo(map);
  markerGroup.addTo(map);

  return {
    update,
    setTime,
    setSelected,
    setHovered,
    setVisible,
    focus,
    fitAll,
    destroy,
    get visible() { return visible; },
    get size() { return entries.size; },
  };
}
