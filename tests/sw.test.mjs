import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from './load.mjs';

// Minimal browser-ish environment for sw.js
const listeners = {};
const cacheStore = new Map();
let putCalls = [];
globalThis.self = {
  addEventListener: (ev, fn) => { listeners[ev] = fn; },
  skipWaiting: () => Promise.resolve(),
  clients: { claim: () => Promise.resolve() },
};
globalThis.caches = {
  open: async () => ({
    put: async (req, res) => { putCalls.push([req.url, res.status]); cacheStore.set(req.url, res); },
    addAll: async () => {},
  }),
  match: async (req) => cacheStore.get(typeof req === 'string' ? req : req.url),
  keys: async () => [],
  delete: async () => true,
};
let nextResponse;
globalThis.fetch = async () => nextResponse;

loadScript('sw.js');

function fakeResponse(status) {
  return { status, ok: status >= 200 && status < 300, clone() { return { status, ok: this.ok }; } };
}
function dispatchFetch(url) {
  const waits = [];
  let responded;
  listeners.fetch({
    request: { method: 'GET', url },
    respondWith: (p) => { responded = p; },
    waitUntil: (p) => { waits.push(p); },
  });
  return { responded, waits };
}

beforeEach(() => { putCalls = []; cacheStore.clear(); });

test('caches a 200 response and keeps the worker alive via waitUntil', async () => {
  nextResponse = fakeResponse(200);
  const { responded, waits } = dispatchFetch('http://x/index.html');
  const res = await responded;
  assert.equal(res.status, 200);
  assert.equal(waits.length, 1, 'cache write must be passed to e.waitUntil');
  await Promise.all(waits);
  assert.deepEqual(putCalls, [['http://x/index.html', 200]]);
});

test('does not cache a 404 response', async () => {
  nextResponse = fakeResponse(404);
  const { responded, waits } = dispatchFetch('http://x/missing.png');
  const res = await responded;
  assert.equal(res.status, 404);
  await Promise.all(waits);
  assert.deepEqual(putCalls, [], '404 must not be written to cache');
});

test('falls back to cache when fetch rejects (offline)', async () => {
  cacheStore.set('http://x/game.js', fakeResponse(200));
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  const { responded } = dispatchFetch('http://x/game.js');
  const res = await responded;
  assert.equal(res.status, 200);
  globalThis.fetch = async () => nextResponse;
});
