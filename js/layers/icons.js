/**
 * icons.js — inline SVG icon set.
 *
 * All markup here is authored in code (never derived from feed data), so it is
 * safe to inject with innerHTML. Icons are square, use `currentColor`, and are
 * sized by their container.
 */

/** Exclamation mark in a circle — the incident glyph. */
export const GLYPH = {
  exclamation: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M12 5.6v8.2" stroke="currentColor" stroke-width="3.1" stroke-linecap="round"/>
    <circle cx="12" cy="18.3" r="1.75" fill="currentColor"/>
  </svg>`,

  cone: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M12 3.5 18.6 19.5H5.4L12 3.5Z" fill="currentColor"/>
    <path d="M3.2 20.4h17.6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
  </svg>`,

  car: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M4 15.5v2.2a.8.8 0 0 0 .8.8h1.6a.8.8 0 0 0 .8-.8v-1.1h9.6v1.1a.8.8 0 0 0 .8.8h1.6a.8.8 0 0 0 .8-.8v-2.2" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round"/>
    <path d="M4 15.6h16l-.9-4.3a2 2 0 0 0-1.5-1.5 26 26 0 0 0-11.2 0 2 2 0 0 0-1.5 1.5L4 15.6Z" fill="currentColor"/>
  </svg>`,

  barrier: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <rect x="2.5" y="8.5" width="19" height="7" rx="1.1" fill="currentColor"/>
    <path d="M5.5 15.5v5M18.5 15.5v5" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>
  </svg>`,

  close: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>`,

  chevronLeft: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M15 5 8 12l7 7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,

  chevronRight: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M9 5l7 7-7 7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,

  play: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M8 5.2v13.6L19 12 8 5.2Z" fill="currentColor"/>
  </svg>`,

  pause: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <rect x="7" y="5" width="3.6" height="14" rx="1" fill="currentColor"/>
    <rect x="13.4" y="5" width="3.6" height="14" rx="1" fill="currentColor"/>
  </svg>`,

  refresh: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M20 12a8 8 0 1 1-2.6-5.9" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>
    <path d="M20 3.5V9h-5.5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,

  target: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle cx="12" cy="12" r="6.4" stroke="currentColor" stroke-width="2" fill="none"/>
    <path d="M12 1.8v3.4M12 18.8v3.4M1.8 12h3.4M18.8 12h3.4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>`,

  camera: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <rect x="2.5" y="7" width="15" height="10" rx="2" fill="currentColor"/>
    <path d="M17.5 11.4 22 8.6v6.8l-4.5-2.8Z" fill="currentColor"/>
  </svg>`,

  flow: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M3 8h18M3 12h12M3 16h15" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
  </svg>`,

  layers: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="m12 3 9 5-9 5-9-5 9-5Z" fill="currentColor"/>
    <path d="m3.5 12.5 8.5 4.7 8.5-4.7" stroke="currentColor" stroke-width="1.9" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
};

/** Incident type → glyph key. */
const TYPE_GLYPH = {
  collision: 'exclamation',
  disabled: 'car',
  construction: 'cone',
  closure: 'barrier',
  hazard: 'exclamation',
  weather: 'exclamation',
  event: 'exclamation',
  other: 'exclamation',
};

/**
 * Glyph markup for an incident type.
 * WSDOT-style legend uses a plain exclamation for every alert; we keep that as
 * the default and only specialise where it genuinely aids recognition.
 * @param {string} type
 * @param {{ typed?: boolean }} [opts] typed=false forces the exclamation glyph
 */
export function glyphForType(type, opts = {}) {
  if (opts.typed === false) return GLYPH.exclamation;
  return GLYPH[TYPE_GLYPH[type] ?? 'exclamation'] ?? GLYPH.exclamation;
}

/**
 * Full marker markup for a Leaflet DivIcon.
 *
 * The badge carries the severity colour twice: as `background` for the fill,
 * and as `color` so that `currentColor` resolves to it for the pulse ring and
 * the selection halo. Selected styling comes from the `inc-marker--selected`
 * modifier on the DivIcon's own className, not from here.
 *
 * @param {{ color:string, glyph:string, pulse?:boolean }} opts
 * @returns {string}
 */
export function markerHtml({ color, glyph, pulse = false }) {
  const pulseNode = pulse ? '<span class="inc-marker__pulse"></span>' : '';
  return (
    `<span class="inc-marker__badge" style="background:${color};color:${color}">` +
      pulseNode +
      `<span class="inc-marker__glyph">${glyph}</span>` +
    '</span>'
  );
}
