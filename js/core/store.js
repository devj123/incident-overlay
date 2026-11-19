/**
 * store.js — minimal observable state container.
 *
 * Deliberately tiny: one object, shallow merge on write, subscribers notified
 * only when a value they care about actually changed (Object.is comparison).
 *
 * Pure JS; unit-tested in tests/store.test.mjs.
 */

/**
 * @template {object} S
 * @param {S} initialState
 */
export function createStore(initialState) {
  let state = { ...initialState };
  /** @type {Set<{fn:Function, selector:Function|null, last:any}>} */
  const subscribers = new Set();
  let notifyDepth = 0;
  let dirty = false;

  /** Where subscriber faults go. Swappable so tests can assert on them. */
  let onSubscriberError = (error) => {
    console.error('[store] subscriber threw:', error);
  };

  function getState() {
    return state;
  }

  /**
   * Shallow-merge a patch (or the result of an updater) into state.
   * @param {Partial<S>|((s:S)=>Partial<S>)} patch
   */
  function setState(patch) {
    const next = typeof patch === 'function' ? patch(state) : patch;
    if (!next) return state;

    let changed = false;
    for (const key of Object.keys(next)) {
      if (!Object.is(state[key], next[key])) { changed = true; break; }
    }
    if (!changed) return state;

    const prev = state;
    state = { ...state, ...next };
    notify(prev);
    return state;
  }

  function notify(prev) {
    // Guard against a subscriber calling setState re-entrantly.
    if (notifyDepth > 0) { dirty = true; return; }
    notifyDepth += 1;
    try {
      for (const sub of Array.from(subscribers)) {
        if (!subscribers.has(sub)) continue;   // unsubscribed mid-loop

        // A throwing subscriber must not take down its siblings, and must not
        // propagate back to whoever called setState. Without this, a rendering
        // fault in one layer surfaces as a failure in whatever triggered the
        // update — e.g. a broken map layer getting reported as a feed outage.
        try {
          if (sub.selector) {
            const value = sub.selector(state);
            if (Object.is(value, sub.last)) continue;
            sub.last = value;
            sub.fn(value, state, prev);
          } else {
            sub.fn(state, prev);
          }
        } catch (error) {
          onSubscriberError(error, sub);
        }
      }
    } finally {
      notifyDepth -= 1;
    }
    if (dirty) { dirty = false; notify(prev); }
  }

  /**
   * Subscribe to all state changes.
   * @param {(state:S, prev:S)=>void} fn
   * @returns {()=>void} unsubscribe
   */
  function subscribe(fn) {
    const sub = { fn, selector: null, last: undefined };
    subscribers.add(sub);
    return () => subscribers.delete(sub);
  }

  /**
   * Subscribe to a derived slice; fires only when the slice changes.
   * @template T
   * @param {(state:S)=>T} selector
   * @param {(value:T, state:S, prev:S)=>void} fn
   * @param {{immediate?:boolean}} [opts]
   * @returns {()=>void} unsubscribe
   */
  function select(selector, fn, opts = {}) {
    const sub = { fn, selector, last: selector(state) };
    subscribers.add(sub);
    if (opts.immediate) fn(sub.last, state, state);
    return () => subscribers.delete(sub);
  }

  /** Drop every subscriber (used on teardown). */
  function destroy() {
    subscribers.clear();
  }

  /** Replace the subscriber-fault handler. Returns the previous one. */
  function setErrorHandler(fn) {
    const previous = onSubscriberError;
    onSubscriberError = fn;
    return previous;
  }

  return { getState, setState, subscribe, select, destroy, setErrorHandler };
}
