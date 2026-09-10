# Noodle Pit Polish & Feel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Noodle Pit feel like a shipped game — synthesized sound, canvas juice, a designed UI, and working persistence — without adding a build step, dependency, or asset file.

**Architecture:** Split the single `index.html` into `index.html` + `style.css` + `audio.js` (`window.Sound`) + `fx.js` (`window.FX`) + `game.js`, all plain `<script>`/`<link>` tags. `audio.js` and `fx.js` are DOM-free and Node-loadable so they get real `node --test` suites; `game.js` stays a DOM-bound IIFE verified in the browser. Fix the save system, HUD best-score, and service-worker caching first, then layer audio, FX, and UI on top. Each task leaves the game playable.

**Tech Stack:** Vanilla JS (ES2020), Canvas 2D, Web Audio API, Service Worker, Node 24 built-in test runner (`node --test`, `node:assert`, `node:vm`) — zero npm dependencies. Local serving via `python -m http.server`.

**Spec:** `docs/superpowers/specs/2026-09-09-polish-and-feel-design.md`

## Global Constraints

- No bundler, framework, npm dependency, or build step. No `type="module"` on shipped scripts.
- No external asset files: all audio synthesized, all visuals drawn in canvas/CSS.
- Script load order in `index.html`: `audio.js`, `fx.js`, then `game.js`.
- `audio.js` assigns `window.Sound`; `fx.js` assigns `window.FX`; both must load in Node (`typeof window !== 'undefined' ? window : globalThis`).
- `localStorage` keys: `noodleBest`, `noodleEaten`, `noodleSkin`, `noodleRound`, and new `noodleMuted` (`'1'`/`'0'`).
- `sw.js` `CACHE` bumped to `noodle-pit-v2` in this change set (bump once more before any later ship).
- SW cache list must include `style.css`, `audio.js`, `fx.js`, `game.js`; must not include `tests/` or `docs/`.
- Music sits ≈ −18 dB under SFX (`MUSIC_LEVEL = 0.13`, `SFX_LEVEL = 0.8`).
- Particle caps: world 400, screen 120. Time units in `fx.js` are frames (60 fps): 250 ms ≈ 15, 600 ms ≈ 36, 450 ms ≈ 27.
- Screen shake: death 14 px/27 f; eat worm `min(10, 3+len/20)` px/15 f; King eaten 18 px/36 f. Never for rival-vs-rival kills.
- Commit after every task with the attribution trailer:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01D1cdBkAH34VGswPpCV6FYm
  ```
- Run all tests with `node --test` from the repo root. Manual browser checks: `python -m http.server 8080` in the repo root, open `http://localhost:8080/`, DevTools device toolbar at 390×844 (iPhone 14).

---

## File map

| File | Status | Responsibility |
|------|--------|----------------|
| `index.html` | modify | Head + markup only. Links CSS, loads the three scripts in order. |
| `style.css` | create | All CSS (moved from `<style>`), plus overlay transitions, HUD buttons, pop/press animations. |
| `audio.js` | create | `window.Sound`: unlock/play/boost/music/setMuted/muted. Synth only. |
| `fx.js` | create | `window.FX`: particles, shake, flash. Pure data + canvas draw helpers. |
| `game.js` | create | Game IIFE moved from `index.html`, then extended: store fix, HUD, FX + Sound hooks, overlay templates, pause. |
| `sw.js` | modify | `res.ok` guard + `waitUntil` on cache write; asset list; `CACHE` bump. |
| `.nojekyll` | create | Empty. Matches README. |
| `README.md` | modify | Files/controls sections. |
| `tests/load.mjs` | create | Helper: run a classic script into `globalThis` via `node:vm`. |
| `tests/sw.test.mjs` | create | Fetch-handler behaviour with stubbed `self`/`caches`/`fetch`. |
| `tests/fx.test.mjs` | create | Particle caps, expiry, shake decay, flash, `enabled` gate. |
| `tests/audio.test.mjs` | create | Unlock idempotence, mute, boost idempotence, music mode switching, eat throttle — with a fake `AudioContext`. |

---

### Task 1: Test harness + service-worker fetch fix

**Files:**
- Create: `tests/load.mjs`
- Create: `tests/sw.test.mjs`
- Modify: `sw.js:11-18`

**Interfaces:**
- Produces: `loadScript(relPath)` in `tests/load.mjs` — reads `../<relPath>` relative to `tests/` and runs it with `vm.runInThisContext`, so IIFE scripts that assign to `globalThis`/`self`/`window` land on Node's global. Later tasks' tests import this.

- [ ] **Step 1: Write the loader helper**

`tests/load.mjs`:
```js
import fs from 'node:fs';
import vm from 'node:vm';

// Run a classic (non-module) script in Node's global scope, as a browser <script> tag would.
export function loadScript(relPath) {
  const url = new URL('../' + relPath, import.meta.url);
  vm.runInThisContext(fs.readFileSync(url, 'utf8'), { filename: relPath });
}
```

- [ ] **Step 2: Write the failing SW tests**

`tests/sw.test.mjs`:
```js
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test`
Expected: test 1 FAILS (`waits.length` is 0 — current handler never calls `waitUntil`); test 2 FAILS (`putCalls` contains the 404); test 3 passes.

- [ ] **Step 4: Fix the fetch handler**

Replace `sw.js` lines 11-18 with:
```js
// Network first (so updates land), fall back to cache when offline.
// Only good responses are cached, and the write is kept alive with waitUntil
// so the browser can't kill the worker mid-put.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) {
        const copy = res.clone();
        e.waitUntil(caches.open(CACHE).then(c => c.put(e.request, copy)));
      }
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test`
Expected: 3 passing.

- [ ] **Step 6: Commit**

```bash
git add tests/load.mjs tests/sw.test.mjs sw.js
git commit -m "fix(sw): only cache ok responses, keep worker alive during cache write

Adds a zero-dependency node --test harness (tests/) with stubs for the
service-worker environment.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01D1cdBkAH34VGswPpCV6FYm"
```

---

### Task 2: Split `index.html` into `style.css` + `game.js`; update SW asset list

**Files:**
- Modify: `index.html` (whole file)
- Create: `style.css`
- Create: `game.js`
- Modify: `sw.js:2-3`
- Create: `.nojekyll`
- Modify: `README.md:19-29`

**Interfaces:**
- Produces: `game.js` containing exactly the IIFE that was `index.html` lines 60–311 (`(() => { … })();`). Later tasks edit this file by snippet.

- [ ] **Step 1: Create `style.css`**

Copy the contents of the `<style>` block (`index.html` lines 15–42, i.e. from `:root {` through `.hidden { display:none !important; }`) verbatim into `style.css`. No changes to rules.

- [ ] **Step 2: Create `game.js`**

Copy `index.html` lines 60–311 verbatim (from `(() => {` through `})();`) into `game.js`. The file's first line is `(() => {` and last line is `})();`.

- [ ] **Step 3: Rewrite `index.html`**

Replace the whole file with:
```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>Noodle Pit</title>
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon-192.png">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<meta name="theme-color" content="#1b1330">
<meta name="apple-mobile-web-app-title" content="Noodle Pit">
<link rel="stylesheet" href="style.css">
</head>
<body>
<canvas id="c"></canvas>
<div id="hud"><div>Length <span id="len">10</span><small id="goal"></small></div><div id="roundLbl">Best <span id="best">0</span></div></div>
<div id="stick"><div id="knob"></div></div>
<button id="boost">BOOST</button>
<div id="overlay">
  <h1>Noodle Pit<span>eat, grow, don't get bonked</span></h1>
  <div id="rounds"></div>
  <div id="skins"></div>
  <p>Five rounds: grow to the target as the biggest worm in the pit, then face the Pit King. Use the joystick to steer. Hold the boost button to speed up (it costs length). Bump into a smaller worm to eat it. Touch a bigger one and it's over.</p>
  <button id="start">Play</button>
  <p id="installHint" style="font-size:13px;opacity:.7;margin:18px 0 0">To install: tap Share, then Add to Home Screen.</p>
</div>

<script src="audio.js"></script>
<script src="fx.js"></script>
<script src="game.js"></script>
</body>
</html>
```
(`audio.js` and `fx.js` don't exist yet; a missing script logs a 404 and the game still runs because `game.js` doesn't reference them until Tasks 5/7. Create both as empty files now so there's no 404 noise:)

```bash
printf '' > audio.js
printf '' > fx.js
```

- [ ] **Step 4: Update the SW asset list and bump the cache**

`sw.js` lines 2–3 become:
```js
const CACHE = 'noodle-pit-v2';
const ASSETS = ['./', './index.html', './style.css', './audio.js', './fx.js', './game.js', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-512-maskable.png', './apple-touch-icon.png'];
```

- [ ] **Step 5: Add `.nojekyll` and fix README files section**

```bash
printf '' > .nojekyll
```

In `README.md`, replace lines 19–29 (the `## Files` section through the stray `.nojekyll` bullet) with:
```markdown
## Files

- `index.html` — page shell and markup
- `style.css` — all styling
- `game.js` — the game: loop, worms, AI, rounds, skins, input, screens
- `audio.js` — synthesized sound effects and music (`Sound`)
- `fx.js` — particles, screen shake, flashes (`FX`)
- `sw.js` — service worker that caches the game for offline play
- `manifest.webmanifest` — makes it installable (fullscreen, portrait, icon)
- `icon-*.png`, `apple-touch-icon.png` — home-screen icons
- `.nojekyll` — tells Pages to serve files as-is
- `tests/` — `node --test` runs the unit tests (not shipped)

## Shipping an update

After changing any shipped file, bump `CACHE` in `sw.js` (e.g. `noodle-pit-v3`) so installed copies pick up the new version on their next launch.
```

- [ ] **Step 6: Syntax-check and run tests**

Run: `node --check game.js && node --test`
Expected: no syntax error; 3 passing.

- [ ] **Step 7: Browser smoke test**

Run: `python -m http.server 8080` (background), open `http://localhost:8080/`.
Expected: title overlay renders styled exactly as before; Play starts a round; joystick and boost work; console shows no errors (404s for `audio.js`/`fx.js` must not appear — they're empty files). DevTools → Application → Service Workers shows `noodle-pit-v2` cache after reload.

- [ ] **Step 8: Commit**

```bash
git add index.html style.css game.js audio.js fx.js sw.js .nojekyll README.md
git commit -m "refactor: split index.html into style.css and game.js

No behaviour change. Adds empty audio.js / fx.js placeholders, lists the
new files in the service worker and bumps CACHE to noodle-pit-v2.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01D1cdBkAH34VGswPpCV6FYm"
```

---

### Task 3: Fix the save system and the HUD best-score

**Files:**
- Modify: `game.js` (the `store` line, `bestEl`/`roundLbl` usages, `reset()`)
- Modify: `index.html` (the `#hud` line)
- Modify: `style.css` (HUD layout)

**Interfaces:**
- Produces: `store.get(k) → string|null`, `store.set(k, v)` actually backed by `localStorage`. Elements `#roundNum`, `#roundName`, `#best` are stable and never replaced. Task 7 adds `#mute` to this HUD; Task 9 adds `#pause`.

- [ ] **Step 1: Fix `store`**

In `game.js`, replace:
```js
const store={get:k=>{try{return store.get(k)}catch(e){return null}},set:(k,v)=>{try{store.set(k,v)}catch(e){}}};
```
with:
```js
const store={get:k=>{try{return localStorage.getItem(k)}catch(e){return null}},set:(k,v)=>{try{localStorage.setItem(k,String(v))}catch(e){}}};
```

- [ ] **Step 2: Give the HUD stable slots**

In `index.html` replace the `#hud` line with:
```html
<div id="hud">
  <div>Length <span id="len">10</span><small id="goal"></small></div>
  <div id="roundLbl">Round <span id="roundNum">1</span> <small id="roundName"></small></div>
  <div>Best <span id="best">0</span></div>
</div>
```

In `game.js`:
- Replace `const goalEl=document.getElementById('goal'), roundLbl=document.getElementById('roundLbl');` with
  `const goalEl=document.getElementById('goal'), roundNumEl=document.getElementById('roundNum'), roundNameEl=document.getElementById('roundName');`
- In `reset()`, replace `roundLbl.innerHTML = 'Round '+(round+1)+' <small>'+R.name+'</small>';` with
  `roundNumEl.textContent = round+1; roundNameEl.textContent = R.name;`

In `style.css` change `#hud`'s `justify-content:space-between` rule so three items read well: append `gap:12px;` and add `#hud > div { white-space:nowrap; }`.

- [ ] **Step 3: Verify**

Run: `node --check game.js && node --test` → passes.

Browser (`http://localhost:8080/`):
1. DevTools → Application → Local Storage → `http://localhost:8080`. Initially empty.
2. Play, boost until length > 10 and die. Expect keys `noodleBest`, `noodleEaten` present with sensible numbers.
3. Reload. HUD "Best" shows the stored value; overlay skin picker respects unlock state (Coral unlocks at best ≥ 30 — reach it once to confirm).
4. Win round 1 (reach 40 and be biggest) → reload → round 2 button unlocked (`noodleRound` = `1`).
5. During a run where you beat your best, the HUD "Best" number updates immediately on the end screen and stays correct into the next round (this was the detached-node bug).

- [ ] **Step 4: Commit**

```bash
git add game.js index.html style.css
git commit -m "fix: persist progress to localStorage and keep HUD best-score live

store.get/set were calling themselves instead of localStorage, so nothing
ever saved. reset() also rebuilt #roundLbl's innerHTML, orphaning the
#best span that bestEl pointed at.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01D1cdBkAH34VGswPpCV6FYm"
```

---

### Task 4: `fx.js` — particles, shake, flash (TDD)

**Files:**
- Create: `fx.js` (replace the empty placeholder)
- Create: `tests/fx.test.mjs`

**Interfaces:**
- Produces `window.FX`:
  - `FX.enabled: boolean` (default `true`; when false every emitter is a no-op)
  - `FX.burst(x, y, n, color, opts?)` — world-space radial burst. `opts: {speed=2.5, life=36, r=2.5}` (frames).
  - `FX.confetti(cx, cy, n, colors[])` — screen-space upward fan with gravity, life 90.
  - `FX.shake(mag, frames)` — replaces current shake if stronger or finished.
  - `FX.shakeOffset() → {x,y}` — random offset scaled by remaining time; `{0,0}` when idle.
  - `FX.flash(cssColor, frames)`
  - `FX.update()` — advance one frame (all systems).
  - `FX.drawWorld(ctx)` — draws world particles; call inside the camera transform.
  - `FX.drawScreen(ctx, W, H)` — draws confetti then flash; call after `ctx.restore()`.
  - `FX.clear()` — drop everything (used on `reset()`).
  - `FX.parts`, `FX.screenParts` arrays; `FX.CAP = 400`, `FX.SCREEN_CAP = 120`; `FX._state.shake.t`, `FX._state.flash.t` for tests.

- [ ] **Step 1: Write the failing tests**

`tests/fx.test.mjs`:
```js
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from './load.mjs';

loadScript('fx.js');
const FX = globalThis.FX;

beforeEach(() => { FX.clear(); FX.enabled = true; });

test('burst adds n particles at the origin', () => {
  FX.burst(10, 20, 5, '#fff');
  assert.equal(FX.parts.length, 5);
  assert.ok(FX.parts.every(p => p.x === 10 && p.y === 20 && p.c === '#fff'));
});

test('world particle count never exceeds CAP; oldest are evicted', () => {
  FX.burst(0, 0, 1, 'first');
  FX.burst(0, 0, FX.CAP + 50, 'rest');
  assert.equal(FX.parts.length, FX.CAP);
  assert.ok(FX.parts.every(p => p.c === 'rest'), 'the earliest particle should have been evicted');
});

test('particles move and expire after life frames', () => {
  FX.burst(0, 0, 3, '#fff', { life: 2 });
  FX.update();
  assert.equal(FX.parts.length, 3);
  assert.ok(FX.parts.some(p => p.x !== 0 || p.y !== 0), 'particles should have moved');
  FX.update();
  assert.equal(FX.parts.length, 0);
});

test('confetti is screen-space, capped, and falls under gravity', () => {
  FX.confetti(100, 100, FX.SCREEN_CAP + 10, ['#a', '#b']);
  assert.equal(FX.screenParts.length, FX.SCREEN_CAP);
  assert.equal(FX.parts.length, 0);
  const vy0 = FX.screenParts[0].vy;
  FX.update();
  assert.ok(FX.screenParts[0].vy > vy0, 'gravity should increase vy each frame');
});

test('shake decays to zero over its duration', () => {
  FX.shake(10, 4);
  const o = FX.shakeOffset();
  assert.ok(Math.abs(o.x) <= 10 && Math.abs(o.y) <= 10);
  assert.equal(FX._state.shake.t, 4);
  for (let i = 0; i < 4; i++) FX.update();
  assert.deepEqual(FX.shakeOffset(), { x: 0, y: 0 });
});

test('a weaker shake does not override a stronger active one', () => {
  FX.shake(14, 27);
  FX.shake(3, 15);
  assert.equal(FX._state.shake.mag, 14);
  assert.equal(FX._state.shake.t, 27);
});

test('flash lasts the given number of frames', () => {
  FX.flash('rgba(255,255,255,.2)', 2);
  assert.equal(FX._state.flash.t, 2);
  FX.update(); FX.update();
  assert.equal(FX._state.flash.t, 0);
});

test('enabled=false makes emitters no-ops', () => {
  FX.enabled = false;
  FX.burst(0, 0, 5, '#fff'); FX.confetti(0, 0, 5, ['#fff']); FX.shake(10, 10); FX.flash('#fff', 3);
  assert.equal(FX.parts.length, 0);
  assert.equal(FX.screenParts.length, 0);
  assert.equal(FX._state.shake.t, 0);
  assert.equal(FX._state.flash.t, 0);
});

test('draw helpers run against a minimal ctx without throwing', () => {
  const calls = [];
  const ctx = new Proxy({}, { get: (_, k) => (k === 'globalAlpha' || k === 'fillStyle') ? 1 : (...a) => calls.push(k), set: () => true });
  FX.burst(0, 0, 2, '#fff'); FX.confetti(0, 0, 2, ['#fff']); FX.flash('#fff', 1);
  FX.drawWorld(ctx); FX.drawScreen(ctx, 100, 100);
  assert.ok(calls.includes('arc') && calls.includes('fillRect'));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --testfx.test.mjs`
Expected: every test FAILS (`FX` is undefined — `fx.js` is empty).

- [ ] **Step 3: Implement `fx.js`**

```js
// Noodle Pit visual effects — particles, screen shake, screen flash.
// No game or DOM knowledge; time unit is frames (~60 fps). Loadable in Node for tests.
(() => {
  const CAP = 400, SCREEN_CAP = 120;
  const parts = [], screenParts = [];
  const shake = { t: 0, T: 0, mag: 0 };
  const flash = { color: null, t: 0 };
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function push(arr, cap, p) { if (arr.length >= cap) arr.shift(); arr.push(p); }
  function step(arr) {
    for (let i = arr.length - 1; i >= 0; i--) {
      const p = arr[i];
      p.x += p.vx; p.y += p.vy;
      if (p.g) p.vy += p.g;
      p.vx *= 0.96; p.vy *= 0.96;
      if (--p.life <= 0) arr.splice(i, 1);
    }
  }
  function drawParts(ctx, arr) {
    for (const p of arr) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.c;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  const FX = {
    enabled: true,
    parts, screenParts, CAP, SCREEN_CAP,
    _state: { shake, flash },
    burst(x, y, n, color, o = {}) {
      if (!FX.enabled) return;
      const speed = o.speed ?? 2.5, life = o.life ?? 36, r = o.r ?? 2.5;
      for (let i = 0; i < n; i++) {
        const a = rnd(0, Math.PI * 2), s = speed * rnd(0.4, 1);
        push(parts, CAP, { x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, c: color, r: r * rnd(0.6, 1.3) });
      }
    },
    confetti(cx, cy, n, colors) {
      if (!FX.enabled) return;
      for (let i = 0; i < n; i++) {
        const a = rnd(-Math.PI * 0.85, -Math.PI * 0.15), s = rnd(3, 9);
        push(screenParts, SCREEN_CAP, { x: cx, y: cy, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 90, max: 90, c: colors[i % colors.length], r: rnd(2.5, 5), g: 0.18 });
      }
    },
    shake(mag, frames) {
      if (!FX.enabled) return;
      if (shake.t <= 0 || mag >= shake.mag) { shake.mag = mag; shake.T = frames; shake.t = frames; }
    },
    shakeOffset() {
      if (shake.t <= 0) return { x: 0, y: 0 };
      const k = shake.mag * shake.t / shake.T;
      return { x: rnd(-1, 1) * k, y: rnd(-1, 1) * k };
    },
    flash(color, frames) { if (!FX.enabled) return; flash.color = color; flash.t = frames; },
    update() {
      step(parts); step(screenParts);
      if (shake.t > 0) shake.t--;
      if (flash.t > 0) flash.t--;
    },
    drawWorld(ctx) { drawParts(ctx, parts); },
    drawScreen(ctx, W, H) {
      drawParts(ctx, screenParts);
      if (flash.t > 0 && flash.color) { ctx.fillStyle = flash.color; ctx.fillRect(0, 0, W, H); }
    },
    clear() { parts.length = 0; screenParts.length = 0; shake.t = 0; shake.mag = 0; flash.t = 0; },
  };
  (typeof window !== 'undefined' ? window : globalThis).FX = FX;
})();
```

- [ ] **Step 4: Run tests**

Run: `node --test`
Expected: all fx + sw tests pass (12 total).

- [ ] **Step 5: Commit**

```bash
git add fx.js tests/fx.test.mjs
git commit -m "feat(fx): particle, screen-shake and flash module with tests

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01D1cdBkAH34VGswPpCV6FYm"
```

---

### Task 5: Wire FX into the game (particles, shake, flashes, boost trail, pops)

**Files:**
- Modify: `game.js` — `reset()`, `kill()`, `update()` (eat + collision + camera), `draw()`, `paintBody()`, `roundWin()`, `gameOver()`
- Modify: `style.css` — `.pop` keyframes

**Interfaces:**
- Consumes: `FX.*` from Task 4.
- Produces: `kill(s, by)` signature — second arg is the killer worm or `null` (wall). `playerHitWall` boolean set in the wall branch, read by Task 7 for the `wall` SFX. `lenPop()` helper used by Task 8.

- [ ] **Step 1: Clear FX on reset; add the length-pop helper**

In `game.js` `reset()`, first line inside the function add `FX.clear();`.

After the `lenEl`/`bestEl` declarations add:
```js
let lastLen = 10;
function lenPop(){ lenEl.classList.remove('pop'); void lenEl.offsetWidth; lenEl.classList.add('pop'); }
```

In `style.css` add:
```css
#len { display:inline-block; }
#len.pop { animation: pop .16s ease-out; }
@keyframes pop { 0%{transform:scale(1)} 40%{transform:scale(1.35)} 100%{transform:scale(1)} }
```

- [ ] **Step 2: Particles + shake on kills**

Replace `kill(s)`:
```js
function kill(s, by){
  s.dead = true;
  for (let i=0;i<s.pts.length;i+=2){ const p=s.pts[i]; mkFood(p.x+rnd(-4,4), p.y+rnd(-4,4), 2); }
  FX.burst(s.x, s.y, Math.min(24, 12 + (s.len/12|0)), s.c, { speed: 3.5, life: 36, r: 3 });
  if (s === player){
    FX.shake(14, 27); FX.flash('rgba(255,93,74,.35)', 3);
    gameOver();
  } else {
    if (by === player){
      FX.burst(player.x, player.y, 8, '#c9f24a', { speed: 5, life: 20, r: 2 });
      FX.shake(Math.min(10, 3 + s.len/20), 15); FX.flash('rgba(255,255,255,.18)', 2);
      if (s.isKing) FX.shake(18, 36);
    }
    if (!s.isKing) setTimeout(()=>{ if(!running) return; const i=worms.indexOf(s); if(i>-1) worms[i]=mkWorm(false); }, 1500);
  }
}
```
Update the two `kill(...)` call sites in the collision loop: `if (s.len < o.len) kill(s, o);` and `kill(o, s);`. The wall branch becomes:
```js
if (Math.hypot(s.x,s.y) > ARENA){ if (s===player) playerHitWall = true; kill(s, null); continue; }
```
and declare `let playerHitWall = false;` next to `let worms = [] …`; set `playerHitWall = false;` in `reset()`.

- [ ] **Step 3: Pellet particles + length pop**

In `update()`'s eat loop, change the body to:
```js
if((f.x-s.x)**2+(f.y-s.y)**2 < r*r){ s.len += f.v; if (s===player) FX.burst(f.x, f.y, 3, f.c, { speed: 1.8, life: 15, r: 1.8 }); food.splice(i,1); }
```
At the end of `update()` replace `lenEl.textContent = player.len;` with:
```js
if (player.len !== lastLen){ if (player.len > lastLen) lenPop(); lastLen = player.len; lenEl.textContent = player.len; }
```
Also set `lastLen = player.len; lenEl.textContent = player.len;` at the end of `reset()`.

- [ ] **Step 4: Camera tightening + FX update**

In `update()` replace the camera line with:
```js
const camK = player.boost ? 0.18 : 0.12;
cam.x += (player.x-cam.x)*camK; cam.y += (player.y-cam.y)*camK;
FX.update();
```
Note `FX.update()` must run even when paused/not running so bursts finish — so also call `FX.update()` in `loop()` when `!running`: `function loop(){ if(running) update(); else FX.update(); draw(); requestAnimationFrame(loop); }`.

- [ ] **Step 5: Draw hooks — shake, world particles, screen particles/flash**

In `draw()`:
- Replace `ctx.save(); ctx.translate(W/2-cam.x, H/2-cam.y);` with
  `const sh = FX.shakeOffset(); ctx.save(); ctx.translate(W/2-cam.x+sh.x, H/2-cam.y+sh.y);`
- After the food loop and before `// worms`, add `FX.drawWorld(ctx);`
- After `ctx.restore();` add `FX.drawScreen(ctx, W, H);`

- [ ] **Step 6: Boost trail + head squash + pupil tracking in `paintBody`**

Replace the first body line of `paintBody` (`if (boost || skin.type==='glow'){ … }`) with:
```js
if (boost){
  // speed lines fanning out behind the head
  const bx = hx - Math.cos(ang)*r*1.5, by = hy - Math.sin(ang)*r*1.5;
  ctx.strokeStyle = skin.c; ctx.lineWidth = 2;
  for (let k=0;k<5;k++){
    const a = ang + Math.PI + (k-2)*0.22 + rnd(-0.05,0.05), L = r*(2+Math.random()*3);
    ctx.globalAlpha = 0.5*(1-Math.abs(k-2)/3);
    ctx.beginPath(); ctx.moveTo(bx,by); ctx.lineTo(bx+Math.cos(a)*L, by+Math.sin(a)*L); ctx.stroke();
  }
  ctx.globalAlpha = .18 + .1*Math.sin(tick/3);
  ctx.fillStyle = skin.c; for(let i=n-1;i>=0;i-=2){ ctx.beginPath(); ctx.arc(pts[i].x,pts[i].y,r*1.7,0,Math.PI*2); ctx.fill(); }
  ctx.globalAlpha = 1;
} else if (skin.type==='glow'){
  ctx.globalAlpha=.25; ctx.fillStyle=skin.c; for(let i=n-1;i>=0;i-=2){ ctx.beginPath(); ctx.arc(pts[i].x,pts[i].y,r*1.7,0,Math.PI*2); ctx.fill(); } ctx.globalAlpha=1;
}
```
`paintBody` already receives `hx, hy` (unused today) — they're the head position.

Head squash: in `update()`, after `s.ang += Math.max(-0.11, Math.min(0.11, d));` add `s.turn = Math.abs(Math.max(-0.11, Math.min(0.11, d)))/0.11;`. In `paintBody`'s ring loop, change the `ri` computation to
`const t=i/n, ri = r*(0.35+0.65*Math.pow(1-t,0.6)) * (i<3?1.12+0.15*(squash||0):1);`
and add a `squash` parameter: signature becomes `paintBody(pts, r, skin, boost, ang, hx, hy, squash)`. Pass `s.turn` from `draw()`: `paintBody(s.pts, r, s.skin || {c:s.c,type:'solid'}, s.boost, s.ang, s.x, s.y, s.turn);`. `buildSkinPicker`'s call passes nothing extra (squash undefined → 0).

Pupil tracking (player only) in `draw()`: before the pupil `ctx.fillStyle='#1b1330';` line add
```js
let look = 0; if (s===player && steer!=null){ let d=steer-s.ang; d=Math.atan2(Math.sin(d),Math.cos(d)); look = Math.max(-1,Math.min(1,d/1.2)); }
const px = Math.cos(s.ang+look*0.6)*r*.1, py = Math.sin(s.ang+look*0.6)*r*.1;
```
and add `+px`/`+py` to both pupil arc centres: `ctx.arc(s.x+ex+fx*1.6+px, s.y+ey+fy*1.6+py, …)` and `ctx.arc(s.x-ex+fx*1.6+px, s.y-ey+fy*1.6+py, …)`.

- [ ] **Step 7: Round-win confetti and flash**

At the top of `roundWin()` (after `running=false;`) add:
```js
FX.flash('rgba(201,242,74,.30)', 3);
FX.confetti(W/2, H*0.45, 60, PALETTE);
```

- [ ] **Step 8: Verify**

Run: `node --check game.js && node --test` → passes.

Browser at 390×844 and desktop:
1. Eat pellets: 3 tiny particles per pellet in pellet colour; Length number pops.
2. Boost: speed lines fan behind the head, halo pulses, camera leads slightly.
3. Eat a small worm: white/lime sparks, body-coloured burst, brief white flash, small shake.
4. Die: coral flash, big shake, burst in your colour.
5. Win a round: lime flash + confetti falling from upper-centre while the overlay shows.
6. Rival kills another rival off-screen: no shake, no flash.
7. DevTools Performance with 4× CPU throttle during a boost through a food cloud: frame time stays under ~16 ms on average. If not, lower `FX.CAP` — do not add complexity.
8. Console: no errors.

- [ ] **Step 9: Commit**

```bash
git add game.js style.css
git commit -m "feat: visual juice — particles, shake, flashes, boost trail, pops

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01D1cdBkAH34VGswPpCV6FYm"
```

---

### Task 6: `audio.js` — synthesized SFX and music (TDD)

**Files:**
- Create: `audio.js` (replace the empty placeholder)
- Create: `tests/audio.test.mjs`

**Interfaces:**
- Produces `window.Sound`:
  - `Sound.unlock() → boolean` — creates/resumes the `AudioContext`; idempotent; applies any pending `music()` mode. Returns `false` if Web Audio is unavailable.
  - `Sound.play(name, arg?)` — `name ∈ 'eat'|'eatWorm'|'death'|'wall'|'roundWin'|'unlock'|'tap'`. `eat(v)` takes pellet value; `eatWorm(len)` takes eaten worm length. No-op before unlock or when muted.
  - `Sound.boost(on: boolean)` — idempotent held hum.
  - `Sound.music(mode)` — `'menu'|'play'|'king'|'off'`; no-op if already in that mode; remembered if called before unlock.
  - `Sound.setMuted(bool)`, `Sound.muted` getter.
  - `Sound._state() → { unlocked, mode, boosting }` for tests.

- [ ] **Step 1: Write the failing tests**

`tests/audio.test.mjs`:
```js
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from './load.mjs';

// ---- fake Web Audio -------------------------------------------------------
const made = { ctx: 0, osc: 0, gain: 0, src: 0 };
function param(v = 0) {
  const p = { value: v, last: v };
  for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime']) p[m] = (x) => { p.last = x; return p; };
  p.cancelScheduledValues = () => p;
  return p;
}
function node(extra = {}) {
  return { inputs: [], connect(t) { t.inputs.push(this); return t; }, disconnect() {}, start() {}, stop() {}, ...extra };
}
class FakeAudioContext {
  constructor() { made.ctx++; this.currentTime = 0; this.sampleRate = 44100; this.state = 'running'; this.destination = node(); }
  resume() { this.state = 'running'; return Promise.resolve(); }
  createGain() { made.gain++; return node({ gain: param(1) }); }
  createOscillator() { made.osc++; return node({ type: 'sine', frequency: param(440), detune: param(0) }); }
  createBiquadFilter() { return node({ type: 'lowpass', frequency: param(350), Q: param(1) }); }
  createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
  createBufferSource() { made.src++; return node({ buffer: null, loop: false }); }
}
globalThis.AudioContext = FakeAudioContext;
loadScript('audio.js');
const Sound = globalThis.Sound;
const snap = () => ({ ...made });

beforeEach(() => { Sound.music('off'); Sound.boost(false); Sound.setMuted(false); });

test('play/boost/music before unlock are safe no-ops', () => {
  // Sound is not unlocked yet at this point in the file
  assert.equal(Sound._state().unlocked, false);
  assert.doesNotThrow(() => { Sound.play('eat'); Sound.play('eatWorm', 40); Sound.boost(true); Sound.boost(false); });
  assert.equal(made.osc, 0);
});

test('a music mode requested before unlock starts when unlocked', () => {
  Sound.music('menu');
  assert.equal(Sound._state().mode, 'menu');
  assert.equal(made.osc, 0, 'nothing should be created without a context');
  assert.equal(Sound.unlock(), true);
  assert.ok(made.osc > 0, 'drone oscillators should now exist');
  Sound.music('off');
});

test('unlock is idempotent — one AudioContext ever', () => {
  Sound.unlock(); Sound.unlock(); Sound.unlock();
  assert.equal(made.ctx, 1);
  assert.equal(Sound._state().unlocked, true);
});

test('every SFX name plays without throwing and makes at least one node', () => {
  for (const n of ['eat', 'eatWorm', 'death', 'wall', 'roundWin', 'unlock', 'tap']) {
    const before = snap();
    Sound.play(n, 30);
    assert.ok(made.osc + made.src > before.osc + before.src, `${n} should create a source node`);
  }
});

test('setMuted ramps the master gain to 0 and silences SFX', () => {
  Sound.setMuted(true);
  assert.equal(Sound.muted, true);
  const master = Sound._state().ctx.destination.inputs[0];
  assert.equal(master.gain.last, 0);
  const before = snap();
  Sound.play('eat');
  assert.equal(made.osc, before.osc, 'muted play should not schedule nodes');
  Sound.setMuted(false);
  assert.equal(master.gain.last, 1);
});

test('boost(true) twice creates one hum; boost(false) tears it down', () => {
  const before = snap();
  Sound.boost(true); Sound.boost(true);
  assert.equal(made.osc - before.osc, 2, 'one tone oscillator + one LFO');
  assert.equal(Sound._state().boosting, true);
  Sound.boost(false); Sound.boost(false);
  assert.equal(Sound._state().boosting, false);
});

test('music(): same mode is a no-op, switching modes crossfades, off stops', () => {
  Sound.music('play');
  const afterStart = snap();
  Sound.music('play');
  assert.deepEqual(snap(), afterStart, 'repeat mode must not rebuild the graph');
  Sound.music('king');
  assert.ok(made.osc > afterStart.osc, 'new mode builds its own drone');
  assert.equal(Sound._state().mode, 'king');
  Sound.music('off');
  assert.equal(Sound._state().mode, 'off');
});

test('eat SFX is throttled to 8 within 100 ms', () => {
  Sound._state().ctx.currentTime = 10; // move past any earlier eat timestamps (the fake clock never advances on its own)
  const before = snap();
  for (let i = 0; i < 20; i++) Sound.play('eat');
  assert.equal(made.osc - before.osc, 8);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --testaudio.test.mjs`
Expected: all FAIL (`Sound` undefined).

- [ ] **Step 3: Implement `audio.js`**

```js
// Noodle Pit audio — every sound is synthesized with Web Audio. No files, no game knowledge.
// Exposes window.Sound. Safe to call anything before unlock(); it just does nothing until then.
(() => {
  const G = typeof window !== 'undefined' ? window : globalThis;
  const AC = G.AudioContext || G.webkitAudioContext;
  const MUSIC_LEVEL = 0.13, SFX_LEVEL = 0.8;   // music ≈ -18 dB under sfx
  let ac = null, master = null, sfxBus = null, musicBus = null;
  let muted = false, boostNodes = null, music = null, mode = 'off', pendingMode = null;
  const recentEats = [];
  let noiseBuf = null;

  const now = () => ac.currentTime;
  const canPlay = () => !!ac && !muted;

  // attack → peak → exponential decay envelope on a GainNode
  function env(g, t0, a, peak, d) {
    g.gain.cancelScheduledValues(t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }
  // one-shot oscillator voice
  function osc(type, f, t0, dur, bus, peak = 0.5, o = {}) {
    const a = o.a ?? 0.005;
    const v = ac.createOscillator(), g = ac.createGain();
    v.type = type; v.frequency.setValueAtTime(f, t0);
    if (o.to) v.frequency.exponentialRampToValueAtTime(o.to, t0 + dur);
    env(g, t0, a, peak, Math.max(0.01, dur - a));
    v.connect(g).connect(bus); v.start(t0); v.stop(t0 + dur + 0.05);
    return v;
  }
  function noiseBuffer() {
    if (!noiseBuf) {
      noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  }
  // one-shot filtered noise voice
  function noise(t0, dur, bus, peak = 0.4, type = 'lowpass', freq = 800) {
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuffer(); s.loop = true; f.type = type; f.frequency.value = freq;
    env(g, t0, 0.003, peak, Math.max(0.01, dur - 0.003));
    s.connect(f).connect(g).connect(bus); s.start(t0); s.stop(t0 + dur + 0.05);
    return s;
  }

  const SFX = {
    eat(v = 1) {
      const t = now();
      recentEats.push(t); while (recentEats.length && recentEats[0] < t - 0.1) recentEats.shift();
      if (recentEats.length > 8) return;
      osc('sine', 520 + v * 90 + Math.random() * 40, t, 0.09, sfxBus, 0.25, { to: 880 + v * 90 });
    },
    eatWorm(len = 20) {
      const t = now(), k = Math.min(1, len / 150);
      osc('sawtooth', 160 - 60 * k, t, 0.12, sfxBus, 0.35 + 0.25 * k, { to: 90 });
      noise(t, 0.1, sfxBus, 0.25, 'lowpass', 600);
      osc('sine', 300, t + 0.1, 0.22, sfxBus, 0.3, { to: 720 });
    },
    death(off = 0) {
      const t = now() + off;
      osc('square', 320, t, 0.4, sfxBus, 0.3, { to: 60 });
      osc('sine', 200, t, 0.45, sfxBus, 0.3, { to: 40 });
      noise(t, 0.25, sfxBus, 0.5, 'lowpass', 300);
    },
    wall() { osc('square', 1400, now(), 0.06, sfxBus, 0.25, { to: 2400 }); SFX.death(0.06); },
    roundWin() { const t = now(); [523, 659, 784, 1047].forEach((f, i) => osc('triangle', f, t + i * 0.11, 0.3, sfxBus, 0.3)); },
    unlock() { const t = now(); [1, 2, 3].forEach(h => osc('sine', 880 * h, t, 0.6 / h, sfxBus, 0.25 / h)); },
    tap() { noise(now(), 0.02, sfxBus, 0.3, 'highpass', 2000); },
  };

  function boost(on) {
    if (!ac) return;
    if (on && !boostNodes) {
      const o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain(), lfo = ac.createOscillator(), lg = ac.createGain();
      o.type = 'sawtooth'; o.frequency.value = 110;
      f.type = 'lowpass'; f.frequency.value = 500; f.Q.value = 6;
      lfo.frequency.value = 5; lg.gain.value = 250; lfo.connect(lg).connect(f.frequency);
      const t = now(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.18, t + 0.08);
      o.connect(f).connect(g).connect(sfxBus); o.start(); lfo.start();
      boostNodes = { o, lfo, g };
    } else if (!on && boostNodes) {
      const { o, lfo, g } = boostNodes; boostNodes = null;
      const t = now();
      g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0.0001, t + 0.08);
      o.stop(t + 0.1); lfo.stop(t + 0.1);
    }
  }

  // ---- music: generative pad per mode ---------------------------------------
  const MODES = {
    menu: { root: 110,  filter: 600,  pluck: [3, 6], scale: [0, 2, 4, 7, 9],  bpm: 0,  wind: 0 },
    play: { root: 110,  filter: 1200, pluck: [2, 4], scale: [0, 2, 4, 7, 9],  bpm: 70, wind: 0 },
    king: { root: 73.4, filter: 900,  pluck: [2, 4], scale: [0, 2, 3, 7, 8],  bpm: 90, wind: 0.12 },
  };
  function startMusic(m) {
    const p = MODES[m], t = now();
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(1, t + 1); g.connect(musicBus);
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = p.filter; f.Q.value = 1.5; f.connect(g);
    const lfo = ac.createOscillator(), lg = ac.createGain(); lfo.frequency.value = 0.08; lg.gain.value = p.filter * 0.4; lfo.connect(lg).connect(f.frequency); lfo.start();
    const drones = [0, 4].map(det => { const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.value = p.root; o.detune.value = det; o.connect(f); o.start(); return o; });
    const nodes = [...drones, lfo], timers = [];
    const alive = () => music && music.m === m;
    const pluck = () => {
      if (!alive()) return;
      const deg = p.scale[Math.random() * p.scale.length | 0];
      osc('triangle', p.root * 2 * Math.pow(2, deg / 12) * (Math.random() < 0.3 ? 2 : 1), now(), 0.8, g, 0.35, { a: 0.01 });
      timers.push(setTimeout(pluck, (p.pluck[0] + Math.random() * (p.pluck[1] - p.pluck[0])) * 1000));
    };
    timers.push(setTimeout(pluck, 800));
    if (p.bpm) {
      const beat = () => { if (!alive()) return; osc('sine', p.root / 2, now(), 0.18, g, 0.5); timers.push(setTimeout(beat, 60000 / p.bpm)); };
      timers.push(setTimeout(beat, 200));
    }
    if (p.wind) {
      const s = ac.createBufferSource(), bf = ac.createBiquadFilter(), wg = ac.createGain();
      s.buffer = noiseBuffer(); s.loop = true; bf.type = 'bandpass'; bf.frequency.value = 400; bf.Q.value = 0.7; wg.gain.value = p.wind;
      s.connect(bf).connect(wg).connect(g); s.start(); nodes.push(s);
    }
    return { m, g, nodes, timers };
  }
  function stopMusic(mu, fade) {
    const t = now();
    mu.g.gain.cancelScheduledValues(t); mu.g.gain.setValueAtTime(mu.g.gain.value, t); mu.g.gain.linearRampToValueAtTime(0.0001, t + fade);
    mu.nodes.forEach(n => n.stop(t + fade + 0.1));
    mu.timers.forEach(clearTimeout);
  }
  function setMusic(m) {
    if (m === mode) return;
    mode = m;
    if (!ac) { pendingMode = m; return; }
    const old = music;
    music = m === 'off' ? null : startMusic(m);
    if (old) stopMusic(old, m === 'off' ? 0.6 : 1);
  }

  function unlock() {
    if (!AC) return false;
    if (!ac) {
      ac = new AC();
      master = ac.createGain(); master.gain.value = muted ? 0 : 1; master.connect(ac.destination);
      sfxBus = ac.createGain(); sfxBus.gain.value = SFX_LEVEL; sfxBus.connect(master);
      musicBus = ac.createGain(); musicBus.gain.value = MUSIC_LEVEL; musicBus.connect(master);
      if (pendingMode && pendingMode !== 'off') { const m = pendingMode; pendingMode = null; mode = 'off'; setMusic(m); }
    }
    if (ac.state === 'suspended') ac.resume();
    return true;
  }
  function setMuted(b) {
    muted = !!b;
    if (!master) return;
    const t = now();
    master.gain.cancelScheduledValues(t); master.gain.setValueAtTime(master.gain.value, t); master.gain.linearRampToValueAtTime(muted ? 0 : 1, t + 0.03);
  }

  G.Sound = {
    unlock, boost, setMuted,
    play(name, arg) { if (canPlay() && SFX[name]) SFX[name](arg); },
    music: setMusic,
    get muted() { return muted; },
    _state() { return { unlocked: !!ac, mode, boosting: !!boostNodes, ctx: ac }; },
  };
})();
```

- [ ] **Step 4: Run tests**

Run: `node --test`
Expected: all pass (20 total). The process must exit on its own — if it hangs, a music timer wasn't cleared by `music('off')`.

- [ ] **Step 5: Commit**

```bash
git add audio.js tests/audio.test.mjs
git commit -m "feat(audio): Web Audio synth module — SFX, boost hum, generative music

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01D1cdBkAH34VGswPpCV6FYm"
```

---

### Task 7: Wire `Sound` into the game + mute button

**Files:**
- Modify: `game.js` — startup, `start()`, `kill()`, collision eat branch, eat loop, boost transitions, `roundWin()`, `gameOver()`, input handlers
- Modify: `index.html` — add `#mute` to `#hud`
- Modify: `style.css` — HUD button style

**Interfaces:**
- Consumes: `Sound.*` (Task 6), `playerHitWall` (Task 5).
- Produces: `setMuted(b)` game-side helper (persists + updates glyph); `#mute` button; `.hudBtn` CSS class reused by Task 9's pause button.

- [ ] **Step 1: Mute button markup + style**

In `index.html`, inside `#hud` after the Best div add:
```html
<button id="mute" class="hudBtn" aria-label="Toggle sound">🔊</button>
```
In `style.css` add:
```css
.hudBtn { pointer-events:auto; width:36px; height:36px; border-radius:18px; border:0; background:rgba(255,255,255,.14); color:var(--paper); font-size:17px; line-height:36px; text-align:center; text-shadow:none; }
.hudBtn:active { transform:translateY(1px); background:rgba(255,255,255,.22); }
```
(`#hud` keeps `pointer-events:none`; the button opts back in.)

- [ ] **Step 2: Unlock on first gesture, mute state, keyboard**

Near the top of `game.js` (after the `store` line) add:
```js
const muteBtn = document.getElementById('mute');
function setMuted(b){ Sound.setMuted(b); store.set('noodleMuted', b?'1':'0'); muteBtn.textContent = b ? '🔇' : '🔊'; }
setMuted(store.get('noodleMuted')==='1');
muteBtn.addEventListener('pointerdown', e=>{ e.preventDefault(); Sound.unlock(); setMuted(!Sound.muted); Sound.play('tap'); });
const unlockOnce = ()=>{ Sound.unlock(); removeEventListener('pointerdown', unlockOnce); removeEventListener('touchstart', unlockOnce); removeEventListener('keydown', unlockOnce); };
addEventListener('pointerdown', unlockOnce); addEventListener('touchstart', unlockOnce, {passive:true}); addEventListener('keydown', unlockOnce);
addEventListener('keydown', e=>{ if(e.code==='KeyM') setMuted(!Sound.muted); });
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible') Sound.unlock(); });
```

- [ ] **Step 3: Music mode changes**

- End of the file, just before `loop();` in `reset(); buildRoundPicker(); buildSkinPicker(); loop();` add `Sound.music('menu');`.
- In `start()`, after `running=true;` add `Sound.unlock(); Sound.music(ROUNDS[round].king ? 'king' : 'play');`.
- In `roundWin()`, after `running=false;` add `Sound.music('menu'); Sound.play('roundWin');`.
- In `gameOver()`, after `running=false;` add `Sound.music('menu'); Sound.play(playerHitWall ? 'wall' : 'death');`.

- [ ] **Step 4: SFX hooks in gameplay**

- Eat loop (Task 5's version): `if (s===player){ FX.burst(...); Sound.play('eat', f.v); }`.
- Collision eat branch: `s.len += Math.ceil(o.len/2); if(s===player){ eaten++; store.set('noodleEaten',eaten); Sound.play('eatWorm', o.len); } kill(o, s);`
- Boost hum: in `update()`'s player branch replace `s.boost = boosting && s.len>6 ? 1 : 0;` with
  ```js
  const wasBoost = !!s.boost; s.boost = boosting && s.len>6 ? 1 : 0;
  if (!!s.boost !== wasBoost) Sound.boost(!!s.boost);
  ```
  and in `roundWin()` and `gameOver()` after `running=false;` add `Sound.boost(false);`.
- Skin unlock chime: in `gameOver()` after `const newly = …` add `if (newly.length) Sound.play('unlock');`. In `roundWin()` compute the same: after the `best` update add `const newly = SKINS.filter(k=>k.need() && !unlockedBefore.has(k.id)); if (newly.length) Sound.play('unlock');`.
- UI taps: in `buildRoundPicker` and `buildSkinPicker` `onclick` handlers, first statement `Sound.play('tap');`. In `start()` first statement `Sound.play('tap');`.

- [ ] **Step 5: Verify**

Run: `node --check game.js && node --test` → passes.

Browser (desktop, then phone emulation; on a real iPhone if available):
1. Load page: silence. Tap Play: music starts on that same tap (no second tap needed), then play-mode pad with a soft pulse.
2. Eat pellets: blips (pitch varies; rapid eating never clips/stutters). Hold boost: hum ramps in; release: ramps out. Spacebar works the same.
3. Eat a worm: crunch + gulp. Die: descending thud; music returns to the menu pad. Hit the wall: zap then thud.
4. Win a round: arpeggio; skin unlock adds a bell when a new skin unlocks.
5. Round 5: tenser pad (lower, minor plucks, wind).
6. Mute button toggles glyph and silences everything instantly; reload preserves state (`noodleMuted` in Local Storage). `M` key toggles.
7. Switch tabs and back mid-run: audio continues.
8. Console clean; no "AudioContext was not allowed to start" warnings after the first gesture.

- [ ] **Step 6: Commit**

```bash
git add game.js index.html style.css
git commit -m "feat: hook sound into gameplay, add persisted mute toggle

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01D1cdBkAH34VGswPpCV6FYm"
```

---

### Task 8: Overlay transitions, screen templates, picker polish, count-up

**Files:**
- Modify: `game.js` — overlay handling in `roundWin()`, `gameOver()`, `start()`, startup; `buildSkinPicker`; new `showOverlay`/`hideOverlay`/templates/`countUp`
- Modify: `index.html` — `#overlay` initial content becomes empty container
- Modify: `style.css` — overlay transition, `.score` scale-in, picker press/glow/lock glyph

**Interfaces:**
- Consumes: `Sound.play('tap')`, `FX` (already wired).
- Produces: `showOverlay(html, {rounds, skins})`, `hideOverlay()`, `titleScreen()`, `roundClearScreen()`, `gameOverScreen(newly)`, `countUp(el, to)`. Task 9's pause screen uses `showOverlay`/`hideOverlay`.

- [ ] **Step 1: CSS**

In `style.css`:
- Replace `#overlay { position:fixed; inset:0; display:flex; …` by appending to that rule: `opacity:0; transform:scale(.96); pointer-events:none; transition:opacity .25s ease, transform .25s ease;`
- Add:
```css
#overlay.show { opacity:1; transform:none; pointer-events:auto; }
#overlay .score { animation: scoreIn .4s cubic-bezier(.2,.9,.3,1.2); }
@keyframes scoreIn { from{transform:scale(.4); opacity:0} to{transform:none; opacity:1} }
#overlay .sub { font-size:13px; opacity:.7; margin:-14px 0 24px; max-width:300px; line-height:1.4; }
#overlay button:active, .rd:active, .sk:active { transform:translateY(1px); }
.rd.sel, .sk.sel { box-shadow:0 0 0 3px rgba(201,242,74,.35), 0 0 18px rgba(201,242,74,.35); }
.sk.lock::after { content:'🔒'; position:absolute; right:-6px; top:-6px; font-size:14px; filter:drop-shadow(0 1px 2px rgba(0,0,0,.6)); }
```
- Remove the `.hidden { display:none !important; }` rule (no longer used).

- [ ] **Step 2: Empty the overlay in markup**

In `index.html` replace the whole `<div id="overlay">…</div>` block with `<div id="overlay"></div>`. (The install hint moves into `titleScreen()`.)

- [ ] **Step 3: Overlay helpers and templates in `game.js`**

Replace the line `if (matchMedia('(display-mode: standalone)').matches || navigator.standalone){ … }` with:
```js
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
```
Remove the `startBtn` reference from the `const overlay = …, startBtn = …, boostBtn = …` line (it becomes `const overlay = document.getElementById('overlay'), boostBtn = document.getElementById('boost');`) and delete the later `startBtn.onclick = start;` line.

Add after `buildSkinPicker`:
```js
function titleScreen(){
  return `<h1>Noodle Pit<span>eat, grow, don't get bonked</span></h1>
  <div id="rounds"></div><div id="skins"></div>
  <p>Grow to each round's target as the biggest worm in the pit, then eat the Pit King.</p>
  <p class="sub">Joystick steers · hold BOOST to speed up (costs length) · bump smaller worms to eat them</p>
  <button id="start">Play</button>
  ${standalone ? '' : '<p class="sub" style="margin-top:18px">To install: tap Share, then Add to Home Screen.</p>'}`;
}
function roundClearScreen(){
  const prev = ROUNDS[round-1], next = ROUNDS[round];
  return `<h1>Round cleared<span>${prev.name} → ${next.name}</span></h1><div class="score" data-count="${player.len}">0</div>
  <p>${next.king ? 'Final round: the Pit King is waiting. He\'s length '+KING_LEN+' — outgrow him, then eat him.' : 'Next: reach length '+next.target+' as the biggest worm. Rivals start bigger.'}</p>
  <div id="skins"></div><button id="start">Next round</button>`;
}
function winScreen(){
  return `<h1>You rule the pit<span>the King is eaten</span></h1><div class="score" data-count="${player.len}">0</div>
  <p>Every round cleared. The pit is yours — keep playing to chase a new best and finish the skins.</p>
  <div id="skins"></div><button id="start">Play again</button>`;
}
function gameOverScreen(newly){
  return `<h1>Eaten<span>you grew to</span></h1><div class="score" data-count="${player.len}">0</div>
  <p>Best ${best} · worms eaten ${eaten}${newly.length?`<br><b style="color:var(--lime)">New skin unlocked: ${newly.map(k=>k.name).join(', ')}</b>`:''}</p>
  <div id="rounds"></div><div id="skins"></div><button id="start">Retry round ${round+1}</button>`;
}
function countUp(el, to){
  const t0 = performance.now(), dur = 400;
  const f = ()=>{ const k = Math.min(1,(performance.now()-t0)/dur); el.textContent = Math.round(to*(1-Math.pow(1-k,3))); if (k<1) requestAnimationFrame(f); };
  f();
}
function showOverlay(html){
  overlay.innerHTML = html;
  buildRoundPicker(); buildSkinPicker();
  const sc = overlay.querySelector('.score'); if (sc) countUp(sc, +sc.dataset.count);
  const b = overlay.querySelector('#start'); if (b) b.onclick = start;
  overlay.classList.add('show');
  boostBtn.style.display='none';
  Sound.music('menu');
}
function hideOverlay(){ overlay.classList.remove('show'); boostBtn.style.display='flex'; }
```
`buildRoundPicker`/`buildSkinPicker` already bail out when their container is absent, so calling both is safe on every screen.

- [ ] **Step 4: Use them**

- `roundWin()`: after updating `best`/`maxRound`/`round` and playing sounds, replace the `overlay.innerHTML = last ? … : …; overlay.classList.remove('hidden'); buildSkinPicker(); document.getElementById('start').onclick=start;` block with `showOverlay(last ? winScreen() : roundClearScreen());`. Note `round` has already been incremented for the non-last case, which is why `roundClearScreen` reads `ROUNDS[round-1]` as "previous". For `last`, `round` is unchanged.
- `gameOver()`: replace the `overlay.innerHTML = …; buildRoundPicker(); buildSkinPicker(); overlay.classList.remove('hidden'); document.getElementById('start').onclick = start;` block with `showOverlay(gameOverScreen(newly));`. Delete the `boostBtn.style.display='none';` there (showOverlay does it). Remove `Sound.music('menu');` from `roundWin`/`gameOver` since `showOverlay` handles it (keep `Sound.play(...)` lines).
- `start()`: replace `overlay.classList.add('hidden'); boostBtn.style.display='flex';` with `hideOverlay();`.
- Startup line: `reset(); showOverlay(titleScreen()); loop();` (drop the standalone `buildRoundPicker(); buildSkinPicker();` and the `Sound.music('menu');` added in Task 7 — `showOverlay` covers them).

- [ ] **Step 5: Verify**

Run: `node --check game.js && node --test` → passes.

Browser:
1. Load: title screen fades/scales in; install hint visible in a normal tab, hidden when DevTools emulates standalone (Application → Manifest → "display-mode" or by adding to home screen on a phone).
2. Play → overlay fades out, boost button appears; while hidden the overlay's buttons are not clickable (tap where "Play" was — nothing happens).
3. Die → "Eaten" screen: score counts up from 0 over ~0.4 s with the scale-in; round picker + skins present; locked skins show 🔒 top-right; selected picker items glow lime.
4. Win round → "Round cleared" shows previous → next names correctly; win round 5 → "You rule the pit".
5. Every button/picker press ticks (tap SFX) and depresses 1 px.

- [ ] **Step 6: Commit**

```bash
git add game.js index.html style.css
git commit -m "feat(ui): animated overlay with screen templates, picker polish, score count-up

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01D1cdBkAH34VGswPpCV6FYm"
```

---

### Task 9: Pause, auto-pause on tab hide, quit to menu

**Files:**
- Modify: `index.html` — `#pause` button in `#hud`
- Modify: `game.js` — `paused` state, `pause()`/`resume()`/`quitToMenu()`, `pauseScreen()`, `visibilitychange`, `loop()`, `start()`, key handler
- Modify: `style.css` — none beyond `.hudBtn` (already exists)

**Interfaces:**
- Consumes: `showOverlay`, `hideOverlay`, `titleScreen` (Task 8); `Sound.music`, `Sound.boost` (Task 6/7).
- Produces: `paused: boolean`; `Sound` music duck implemented via `Sound.music('menu')` on pause and restoring the play/king mode on resume (no new `Sound` API).

- [ ] **Step 1: Markup**

In `index.html` `#hud`, before the mute button add:
```html
<button id="pause" class="hudBtn" aria-label="Pause" hidden>⏸</button>
```

- [ ] **Step 2: Pause logic**

In `game.js` add after the overlay helpers:
```js
const pauseBtn = document.getElementById('pause');
let paused = false;
function pauseScreen(){
  return `<h1>Paused<span>Round ${round+1} · ${ROUNDS[round].name}</span></h1>
  <p>Length ${player.len}</p>
  <button id="resume">Resume</button>
  <p><button id="quit" style="background:transparent;color:var(--paper);border:2px solid rgba(255,255,255,.35);margin-top:8px">Quit to menu</button></p>`;
}
function pause(){
  if (!running || paused) return;
  paused = true; running = false; boosting = false; Sound.boost(false);
  showOverlay(pauseScreen());
  overlay.querySelector('#resume').onclick = ()=>{ Sound.play('tap'); resume(); };
  overlay.querySelector('#quit').onclick = ()=>{ Sound.play('tap'); quitToMenu(); };
}
function resume(){
  if (!paused) return;
  paused = false; running = true;
  hideOverlay();
  Sound.music(ROUNDS[round].king ? 'king' : 'play');
}
function quitToMenu(){
  paused = false; running = false; Sound.boost(false);
  if (player.len>best){ best=player.len; store.set('noodleBest',best); bestEl.textContent=best; }
  reset();
  showOverlay(titleScreen());
}
pauseBtn.addEventListener('pointerdown', e=>{ e.preventDefault(); Sound.play('tap'); pause(); });
addEventListener('keydown', e=>{ if(e.code==='Escape' || e.code==='KeyP'){ if (paused) resume(); else pause(); } });
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='hidden' && running) pause(); });
```
Show/hide the pause button with the boost button: in `showOverlay` next to `boostBtn.style.display='none';` add `pauseBtn.hidden = true;`; in `hideOverlay` add `pauseBtn.hidden = false;`. In `start()` set `paused = false;`.

`showOverlay` sets `Sound.music('menu')`, which is the "duck" for pause (menu pad is quieter/slower than play). `resume()` restores the run's mode. Keep `FX.update()` running while paused (already true from Task 5's `loop()`), so bursts settle behind the pause screen.

- [ ] **Step 3: Verify**

Run: `node --check game.js && node --test` → passes.

Browser:
1. During play the ⏸ button is visible; on overlays it's hidden.
2. Tap ⏸: worms freeze, boost releases (hum stops), pause screen fades in, music returns to the calmer pad. Resume: game continues from the same state, play/king music returns.
3. `P`/`Esc` toggle pause on desktop.
4. Switch tab (or minimise) mid-run → return: the game is paused, not dead.
5. Quit to menu: title screen; run not counted as a death (`noodleEaten` unchanged, round progress unchanged); best updated only if exceeded.
6. Pausing on the very last frame before a collision does not double-kill (resume, then die normally).

- [ ] **Step 4: Commit**

```bash
git add game.js index.html
git commit -m "feat: pause, auto-pause on tab hide, quit to menu

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01D1cdBkAH34VGswPpCV6FYm"
```

---

### Task 10: Goal hint, README, full regression, push

**Files:**
- Modify: `game.js` — goal tint in `update()`
- Modify: `style.css` — `#goal.met`
- Modify: `README.md` — controls section
- Verify: `sw.js` `CACHE` is `noodle-pit-v2`

- [ ] **Step 1: Goal tint**

`style.css`: `#goal.met { color:var(--lime); opacity:1; }`

`game.js` `update()`, in the round-goal block:
```js
const R=ROUNDS[round];
goalEl.classList.toggle('met', !R.king && player.len>=R.target);
```
(placed just before `if (!player.dead){ … }`; in `reset()` add `goalEl.classList.remove('met');`).

- [ ] **Step 2: README controls**

Replace the `## Controls` section with:
```markdown
## Controls

- Joystick (bottom-left): steer — mouse works on desktop
- Boost button (bottom-right) or spacebar: speed up, costs length
- ⏸ / `P` / `Esc`: pause · 🔊 / `M`: mute (remembered between sessions)

## Development

No build step. Serve the folder (`python -m http.server 8080`) and open `http://localhost:8080/`.
Unit tests for the service worker, audio and FX modules: `node --test`.
```

- [ ] **Step 3: Full regression**

Run: `node --check game.js && node --test` → all pass.

Browser, phone emulation 390×844, then desktop:
1. Hard-reload twice; Application → Cache Storage shows only `noodle-pit-v2` containing `style.css`, `audio.js`, `fx.js`, `game.js`.
2. DevTools Network → Offline → reload: game loads and plays.
3. Full run: rounds 1→5, including a death and retry, a pause/resume, a mute toggle, a quit-to-menu. Confirm: no console errors; HUD Best updates; goal text turns lime when the target is met; all SFX/music/FX triggers observed at least once.
4. Clear site data → reload → defaults (Lime skin, round 1 only), then confirm progress saves again after one round.

- [ ] **Step 4: Commit and push**

```bash
git add game.js style.css README.md
git commit -m "feat: goal-met hint, README controls and dev notes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01D1cdBkAH34VGswPpCV6FYm"
git push -u origin main
```

---

## Self-review notes

- **Spec coverage:** §1 → T2; §2.1 → T3; §2.2 → T3; §2.3 → T1; §3.1–3.5 → T6/T7; §4.1–4.5 → T4/T5; §4.6 → T5 step 8 perf check; §5.1 → T8; §5.2 → T3/T7/T10; §5.3 → T9; §5.4 → T8; §5.5 → T8 (copy, count-up); §6 → each task's verify step + T10. Spec §2.4 items intentionally not scheduled.
- **Names used across tasks:** `kill(s, by)`, `playerHitWall`, `lenPop`, `lastLen`, `setMuted`, `.hudBtn`, `showOverlay`/`hideOverlay`, `titleScreen`/`roundClearScreen`/`winScreen`/`gameOverScreen`/`pauseScreen`, `countUp`, `paused`, `pause`/`resume`/`quitToMenu`, `FX.*`, `Sound.*` — consistent as written.
- `unlockedBefore` is referenced in T7's `roundWin` change; it already exists in the original code (`let unlockedBefore=new Set();` set in `start()`).
