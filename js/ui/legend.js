/**
 * legend.js — flow gradient + severity key.
 * Presentational only; no state, no callbacks.
 */

import { el } from '../util/dom.js';
import { SEVERITY, SEVERITY_ORDER, FLOW } from '../config.js';
import { GLYPH } from '../layers/icons.js';

export function createLegend() {
  const gradient = el('div', {
    class: 'legend__gradient',
    role: 'img',
    'aria-label':
      `Traffic speed scale from ${FLOW.clear.label} to ${FLOW.stopgo.label}`,
  });

  const gradientLabels = el('div', { class: 'legend__gradient-labels' },
    el('span', {}, FLOW.clear.label),
    el('span', {}, FLOW.moving.label),
    el('span', {}, FLOW.slow.label),
    el('span', {}, FLOW.stopgo.label),
  );

  const severities = el('div', { class: 'legend__severities' },
    SEVERITY_ORDER.map((id) => {
      const spec = SEVERITY[id];
      return el('div', { class: 'legend__sev' },
        el('span', {
          class: 'legend__sev-dot',
          style: { background: spec.color },
          html: GLYPH.exclamation,
          'aria-hidden': 'true',
        }),
        el('span', { class: 'legend__sev-label' }, spec.label),
      );
    }),
  );

  const root = el('div', {},
    el('div', { class: 'panel__section' },
      el('h3', { class: 'panel__section-title' }, 'Traffic flow'),
      gradient,
      gradientLabels,
    ),
    el('div', { class: 'panel__section' },
      el('h3', { class: 'panel__section-title' }, 'Alert severity'),
      severities,
    ),
  );

  return { root };
}
