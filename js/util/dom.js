/**
 * dom.js — tiny DOM helpers. No framework, no innerHTML for user data.
 */

/**
 * Create an element.
 *
 *   el('button', { class: 'btn', onclick: fn, 'aria-pressed': 'true' }, 'Save')
 *
 * - `class` / `className`  → className
 * - `dataset: {...}`       → data-* attributes
 * - `style: {...}`         → inline styles
 * - `on*` function values  → addEventListener
 * - `html: '<svg…>'`       → innerHTML (only ever pass trusted, code-authored markup)
 * - everything else        → setAttribute
 *
 * @param {string} tag
 * @param {Record<string, any>} [props]
 * @param {...(Node|string|null|undefined|Array)} children
 * @returns {HTMLElement}
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;

    if (key === 'class' || key === 'className') {
      node.className = value;
    } else if (key === 'dataset') {
      for (const [dk, dv] of Object.entries(value)) {
        if (dv !== null && dv !== undefined) node.dataset[dk] = String(dv);
      }
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(node.style, value);
    } else if (key === 'html') {
      node.innerHTML = value;
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }

  append(node, children);
  return node;
}

/** Append children, flattening arrays and skipping nullish entries. */
export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

/** Remove every child of a node. */
export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** Replace a node's children in one pass. */
export function replaceChildren(node, ...children) {
  clear(node);
  append(node, children);
  return node;
}

/**
 * Parse a trusted SVG string into an element.
 * Used for code-authored icon markup only.
 */
export function svgFromString(markup) {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  return doc.documentElement;
}

/** Toggle a class and return the new state. */
export function toggleClass(node, name, force) {
  return node.classList.toggle(name, force);
}

/**
 * An accessible on/off switch.
 * @param {{ id:string, label:string, checked?:boolean, onChange:(checked:boolean)=>void }} opts
 * @returns {{ root: HTMLElement, input: HTMLInputElement, setChecked:(v:boolean)=>void }}
 */
export function makeSwitch({ id, label, checked = false, onChange }) {
  const input = el('input', {
    type: 'checkbox',
    id,
    checked: checked || null,
    onchange: (e) => onChange?.(e.currentTarget.checked),
  });
  input.checked = checked;

  const root = el('span', { class: 'switch' },
    input,
    el('span', { class: 'switch__track' }),
    el('span', { class: 'switch__thumb' }),
  );
  input.setAttribute('aria-label', label);

  return {
    root,
    input,
    setChecked(v) { input.checked = !!v; },
  };
}

/**
 * Transient message in the bottom-centre toast region.
 * @param {string} message
 * @param {number} [ms]
 */
export function toast(message, ms = 2600) {
  const region = document.getElementById('toast-region');
  if (!region) return;
  const node = el('div', { class: 'toast' }, message);
  region.appendChild(node);
  setTimeout(() => {
    node.style.transition = 'opacity .25s';
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 260);
  }, ms);
}

/**
 * Trailing-edge debounce.
 * @template {(...a:any[])=>any} F
 * @param {F} fn
 * @param {number} wait
 */
export function debounce(fn, wait = 120) {
  let timer = null;
  const wrapped = (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...args); }, wait);
  };
  wrapped.cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  return wrapped;
}

/**
 * Leading-edge throttle keyed to animation frames.
 * @template {(...a:any[])=>any} F
 * @param {F} fn
 */
export function rafThrottle(fn) {
  let queued = false;
  let lastArgs = null;
  const wrapped = (...args) => {
    lastArgs = args;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fn(...lastArgs);
    });
  };
  return wrapped;
}
