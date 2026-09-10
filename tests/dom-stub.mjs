// A deliberately tiny fake browser so game.js can be smoke-run under Node.
// It is not a DOM implementation — just enough surface for game.js to boot,
// start a round, run frames, and be poked via captured event listeners.

const registry = new Map();          // id -> element
const winListeners = {};             // type -> [fn]
let rafCb = null;

function noop() {}
function makeCtx() {
  // Every method returns another ctx-proxy so chained calls like createRadialGradient().addColorStop() work.
  const handler = { get: (t, k) => (k in t ? t[k] : (k === 'canvas' ? {} : () => proxy)), set: (t, k, v) => { t[k] = v; return true; } };
  const proxy = new Proxy({ measureText: () => ({ width: 0 }) }, handler);
  return proxy;
}
function parseAttrs(str) {
  const o = {}; for (const m of str.matchAll(/([\w-]+)="([^"]*)"/g)) o[m[1]] = m[2]; return o;
}
export function makeElement(tag = 'div', attrs = {}) {
  const el = {
    tag, id: attrs.id || '', className: attrs.class || '', dataset: {}, style: {}, children: [], listeners: {},
    textContent: '', hidden: false, offsetWidth: 0, onclick: null, width: 0, height: 0,
    _innerHTML: '',
    get innerHTML() { return this._innerHTML; },
    set innerHTML(html) {
      this._innerHTML = html; this.children = [];
      for (const m of html.matchAll(/<(\w+)([^>]*)>/g)) {
        const a = parseAttrs(m[2]); const child = makeElement(m[1], a);
        for (const [k, v] of Object.entries(a)) if (k.startsWith('data-')) child.dataset[k.slice(5)] = v;
        this.children.push(child); if (child.id) registry.set(child.id, child);
      }
    },
    classList: {
      add: (c) => { const s = new Set(el.className.split(' ').filter(Boolean)); s.add(c); el.className = [...s].join(' '); },
      remove: (c) => { el.className = el.className.split(' ').filter(x => x && x !== c).join(' '); },
      toggle: (c, force) => { const has = el.classList.contains(c); if (force === undefined ? has : !force) el.classList.remove(c); else el.classList.add(c); },
      contains: (c) => el.className.split(' ').includes(c),
    },
    appendChild(c) { this.children.push(c); if (c.id) registry.set(c.id, c); return c; },
    remove: noop, focus: noop, blur: noop, setAttribute(k, v) { this[k] = v; }, removeAttribute: noop,
    addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); },
    removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter(f => f !== fn); },
    dispatch(t, ev = {}) { ev.preventDefault ||= noop; ev.type = t; for (const f of this.listeners[t] || []) f(ev); if (t === 'click' && this.onclick) this.onclick(ev); },
    getBoundingClientRect: () => ({ left: 22, top: 672, width: 150, height: 150 }),
    querySelector(sel) { return findIn(this, sel); },
    querySelectorAll(sel) { const r = findIn(this, sel); return r ? [r] : []; },
    getContext: () => makeCtx(),
  };
  return el;
}
function findIn(root, sel) {
  if (sel.startsWith('#')) return registry.get(sel.slice(1)) || null;
  const cls = sel.slice(1);
  const walk = (e) => { for (const c of e.children) { if (c.className.split(' ').includes(cls)) return c; const r = walk(c); if (r) return r; } return null; };
  return walk(root);
}

export function installDom({ html = '', width = 390, height = 844 } = {}) {
  registry.clear(); rafCb = null;
  const body = makeElement('body'); body.innerHTML = html;
  const storage = new Map();
  globalThis.window = globalThis;
  globalThis.document = {
    body,
    getElementById: (id) => registry.get(id) || null,
    createElement: (tag) => makeElement(tag),
    addEventListener: (t, fn) => { (winListeners[t] ||= []).push(fn); },
    removeEventListener: noop,
    visibilityState: 'visible',
    querySelector: (sel) => findIn(body, sel),
  };
  // Node defines some of these as getter-only globals; defineProperty overrides them cleanly.
  const define = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  define('navigator', { standalone: false });
  define('localStorage', { getItem: (k) => storage.has(k) ? storage.get(k) : null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k), clear: () => storage.clear() });
  globalThis.innerWidth = width; globalThis.innerHeight = height; globalThis.devicePixelRatio = 2;
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.requestAnimationFrame = (cb) => { (rafCb ||= []).push(cb); return 1; };
  globalThis.addEventListener = (t, fn) => { (winListeners[t] ||= []).push(fn); };
  globalThis.removeEventListener = (t, fn) => { winListeners[t] = (winListeners[t] || []).filter(f => f !== fn); };
  return {
    registry, storage, body,
    el: (id) => registry.get(id),
    fireWindow: (t, ev = {}) => { ev.preventDefault ||= noop; for (const f of winListeners[t] || []) f(ev); },
    frame: (n = 1) => { for (let i = 0; i < n; i++) { const cbs = rafCb; rafCb = null; if (!cbs) throw new Error('no rAF callback pending'); for (const cb of cbs) cb(performance.now()); } },
  };
}
