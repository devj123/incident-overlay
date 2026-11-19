/**
 * controlPanel.js — left rail: layer toggles, severity filters, legend.
 *
 * Owns no state of its own: it reads from the store and writes back through
 * setState, so the map and the panel can never disagree.
 */

import { el, makeSwitch, replaceChildren } from '../util/dom.js';
import { SEVERITY, SEVERITY_ORDER } from '../config.js';
import { GLYPH } from '../layers/icons.js';
import { createLegend } from './legend.js';

/**
 * @param {{ store: ReturnType<import('../core/store.js').createStore> }} opts
 */
export function createControlPanel({ store }) {
  /* ------------------------------------------------------------ toggles -- */

  const layerDefs = [
    { key: 'showFlow', label: 'Traffic flow', glyph: GLYPH.flow, color: '#16b98b' },
    { key: 'showIncidents', label: 'Incidents', glyph: GLYPH.exclamation, color: '#d32f2f' },
    // Reveals everything that isn't live at the current instant: already
    // cleared *and* not yet started. "Cleared" alone would be a lie.
    { key: 'showCleared', label: 'Past & planned', glyph: GLYPH.refresh, color: '#8b97a2' },
  ];

  const counts = new Map();
  const switches = new Map();

  const toggleRows = layerDefs.map((def) => {
    const countNode = el('span', { class: 'layer-row__count' }, '0');
    counts.set(def.key, countNode);

    const sw = makeSwitch({
      id: `toggle-${def.key}`,
      label: def.label,
      checked: !!store.getState()[def.key],
      onChange: (checked) => store.setState({ [def.key]: checked }),
    });
    switches.set(def.key, sw);

    return el('div', { class: 'layer-row' },
      el('span', {
        class: 'layer-row__icon',
        style: { background: def.color },
        html: def.glyph,
        'aria-hidden': 'true',
      }),
      el('label', { class: 'layer-row__label', for: `toggle-${def.key}` }, def.label),
      countNode,
      sw.root,
    );
  });

  // The "include cleared" row shows no count.
  counts.get('showCleared').style.display = 'none';

  /* ------------------------------------------------------------- chips ---- */

  const chipNodes = new Map();

  const chips = SEVERITY_ORDER.map((id) => {
    const spec = SEVERITY[id];
    const chip = el('button', {
      type: 'button',
      class: 'chip',
      'aria-pressed': 'true',
      onclick: () => {
        const next = new Set(store.getState().severities);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        // Never let the user filter everything away — that reads as a bug.
        if (next.size === 0) return;
        store.setState({ severities: next });
      },
    },
      el('span', { class: 'chip__dot', style: { background: spec.color } }),
      spec.label,
    );
    chipNodes.set(id, chip);
    return chip;
  });

  const chipRow = el('div', { class: 'chip-row' }, chips);

  /* -------------------------------------------------------------- search -- */

  const search = el('input', {
    type: 'search',
    placeholder: 'Filter by road or keyword…',
    'aria-label': 'Filter incidents by road or keyword',
    style: {
      width: '100%',
      padding: '5px 9px',
      fontSize: '12.5px',
      border: '1px solid var(--line-strong)',
      borderRadius: 'var(--radius-sm)',
      background: 'var(--surface)',
      color: 'var(--ink)',
    },
    oninput: (e) => store.setState({ query: e.currentTarget.value }),
  });

  /* --------------------------------------------------------------- body --- */

  const legend = createLegend();

  const body = el('div', { class: 'panel__body' },
    el('div', { class: 'panel__section' },
      el('h3', { class: 'panel__section-title' }, 'Data layers'),
      toggleRows,
    ),
    el('div', { class: 'panel__section' },
      el('h3', { class: 'panel__section-title' }, 'Severity'),
      chipRow,
    ),
    el('div', { class: 'panel__section' },
      el('h3', { class: 'panel__section-title' }, 'Search'),
      search,
    ),
    legend.root,
  );

  const collapseBtn = el('button', {
    type: 'button',
    class: 'icon-btn',
    'aria-label': 'Collapse panel',
    'aria-expanded': 'true',
    html: GLYPH.chevronLeft,
    onclick: () => setCollapsed(!collapsed),
  });

  const root = el('section', { class: 'panel', 'aria-label': 'Map options' },
    el('header', { class: 'panel__header' },
      el('span', { class: 'layer-row__icon', style: { background: 'var(--accent)' }, html: GLYPH.layers, 'aria-hidden': 'true' }),
      el('h2', { class: 'panel__title' }, 'Map options'),
      el('span', { class: 'panel__spacer' }),
      collapseBtn,
    ),
    body,
  );

  let collapsed = false;
  function setCollapsed(next) {
    collapsed = next;
    body.style.display = next ? 'none' : '';
    collapseBtn.innerHTML = next ? GLYPH.chevronRight : GLYPH.chevronLeft;
    collapseBtn.setAttribute('aria-expanded', String(!next));
    collapseBtn.setAttribute('aria-label', next ? 'Expand panel' : 'Collapse panel');
  }

  /* ---------------------------------------------------------- reactivity -- */

  const unsubscribers = [
    store.select((s) => s.severities, (severities) => {
      for (const [id, chip] of chipNodes) {
        chip.setAttribute('aria-pressed', String(severities.has(id)));
      }
    }, { immediate: true }),

    store.select((s) => s.showFlow, (v) => switches.get('showFlow').setChecked(v), { immediate: true }),
    store.select((s) => s.showIncidents, (v) => switches.get('showIncidents').setChecked(v), { immediate: true }),
    store.select((s) => s.showCleared, (v) => switches.get('showCleared').setChecked(v), { immediate: true }),

    store.select((s) => s.visibleIncidents.length, (n) => {
      counts.get('showIncidents').textContent = String(n);
    }, { immediate: true }),

    store.select((s) => s.flow.length, (n) => {
      counts.get('showFlow').textContent = String(n);
    }, { immediate: true }),
  ];

  function destroy() {
    unsubscribers.forEach((fn) => fn());
  }

  return { root, destroy, setCollapsed };
}
