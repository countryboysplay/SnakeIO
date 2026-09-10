# Noodle Pit — Polish & Feel Pass

**Date:** 2026-09-09
**Status:** Approved design, ready for implementation planning

## Goal

Make Noodle Pit feel like a shipped game without changing what it is: a solo,
offline, dependency-free, no-build PWA worm arena. Four workstreams — sound,
visual juice, UI/UX, and correctness fixes — layered on a small file
restructure that gives each its own home.

Out of scope: new content (rounds, skins, power-ups), online multiplayer,
meta-progression, any bundler/framework/npm dependency, any external asset
files (audio or image).

## Approach

Foundation first, then layers:

1. Split files + fix correctness bugs (save system, HUD best-score, service
   worker). Pure refactor + bugfix; game plays identically afterwards.
2. Audio module.
3. Visual juice.
4. UI/UX pass.

Each phase leaves the game fully playable and deployable.

---

## 1. File structure

| File | Role |
|------|------|
| `index.html` | `<head>`, markup only. Loads `style.css`, then `audio.js`, then `game.js` via plain tags. |
| `style.css` | All CSS currently in the `<style>` block, plus new UI/transition styles. |
| `audio.js` | Web Audio synth engine. Exposes one global, `Sound`. No game knowledge. |
| `game.js` | Everything currently in the `<script>` block: loop, entities, AI, rounds, skins, input, overlay logic. Calls `Sound.*` and the new particle/shake helpers. |
| `sw.js` | Cache list gains `style.css`, `audio.js`, `game.js`; `CACHE` bumped to `noodle-pit-v2`; fetch handler fixed (see §2.3). |
| `README.md` | Files section updated; stale `.nojekyll` line removed (or the file added — pick add, it's harmless and matches the docs). |

Script order matters: `audio.js` defines `Sound` before `game.js` runs.
Both remain IIFEs; `audio.js` assigns `window.Sound`.

No modules (`type="module"`) — keeps `file://` double-click testing working
and avoids CORS surprises on Pages.

## 2. Correctness fixes

### 2.1 Save system (`game.js`)

Current:

```js
const store={get:k=>{try{return store.get(k)}catch(e){return null}},set:(k,v)=>{try{store.set(k,v)}catch(e){}}};
```

`store.get`/`set` recurse into themselves until stack overflow, so every read
returns `null` and every write is a no-op. Fix:

```js
const store={get:k=>{try{return localStorage.getItem(k)}catch(e){return null}},set:(k,v)=>{try{localStorage.setItem(k,String(v))}catch(e){}}};
```

Keys in use: `noodleBest`, `noodleEaten`, `noodleSkin`, `noodleRound`.
New key: `noodleMuted` (`'1'`/`'0'`).

### 2.2 HUD best-score (`index.html` + `game.js`)

`reset()` does `roundLbl.innerHTML = 'Round …'`, which destroys the
`<span id="best">` that `bestEl` references, so best never updates on
screen after the first reset.

Fix: give the HUD three stable slots and never replace their parents:

```html
<div id="hud">
  <div>Length <span id="len">10</span><small id="goal"></small></div>
  <div id="roundLbl">Round <span id="roundNum">1</span> <small id="roundName"></small></div>
  <div>Best <span id="best">0</span></div>
  <button id="mute" aria-label="Toggle sound">🔊</button>
</div>
```

`reset()` writes `roundNum.textContent` / `roundName.textContent` only.

### 2.3 Service worker (`sw.js`)

Two fixes in the fetch handler:

- Only cache `res.ok` responses (fetch resolves on 404/500; those must not be
  written to cache).
- Keep the worker alive until the cache write finishes by chaining the `put`
  into the returned promise (or `e.waitUntil`).

```js
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(res => {
      if (!res.ok) return res;
      const copy = res.clone();
      e.waitUntil(caches.open(CACHE).then(c => c.put(e.request, copy)));
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
```

Network-first strategy is kept as-is.

### 2.4 Not in scope (recorded so they're not forgotten)

- `ctxSwap` shared-context mutation in `buildSkinPicker` — fragile but not
  currently failing. If visual-juice work refactors `paintBody` anyway, pass
  `ctx` as a parameter instead; otherwise leave.
- Duplicate O(worms² × pts) sweeps in AI steering and collision. Not
  currently a measured problem; revisit only if juice work drops frame rate on
  phones.

---

## 3. Audio (`audio.js`)

All sound is synthesized with Web Audio. No files, no fetches.

### 3.1 Public API (`window.Sound`)

```js
Sound.unlock()          // call on first user gesture; creates/resumes AudioContext. Idempotent.
Sound.play(name)        // one-shot SFX by name (see 3.2). No-op if muted or not unlocked.
Sound.boost(on)         // start/stop the held boost tone. Idempotent.
Sound.music(mode)       // 'menu' | 'play' | 'king' | 'off'. Crossfades between modes.
Sound.setMuted(bool)    // silences master gain; persists nothing itself (game.js owns the store key).
Sound.muted             // boolean getter.
```

Master chain: `[sfx gain] + [music gain] → master gain → destination`.
Mute sets master gain to 0 with a 30 ms ramp (no click).

### 3.2 SFX set

| Name | When (`game.js` hook) | Sound sketch |
|------|-----------------------|--------------|
| `eat` | player eats a pellet | short sine blip, pitch scales slightly with pellet value; tiny random detune so rapid eating isn't monotone |
| `eatWorm` | player kills a rival (collision branch, `s===player`) | two-stage: low sawtooth crunch → rising gulp. Louder/lower for larger `o.len` |
| `death` | `gameOver()` | descending square/sine, 400 ms, with a noise burst thud |
| `roundWin` | `roundWin()` | 3–4 note ascending arpeggio, triangle wave |
| `unlock` | new skin unlocked (in `gameOver()`/`roundWin()` where `newly` is computed) | bright bell (sine + 2 harmonics, fast decay) |
| `tap` | any overlay button/picker press | very short click (filtered noise, 20 ms) |
| `wall` | player hits the arena wall (kill path where `hypot > ARENA`) | same as `death` but preceded by a short high "zap" |
| boost (held) | `Sound.boost(true/false)` on `boosting` transitions | filtered sawtooth hum + slow LFO on filter cutoff; ramps in/out over 80 ms |

Each SFX is a small function that creates oscillators/gain nodes, schedules
an envelope, and lets nodes garbage-collect after `stop()`. Cap concurrent
`eat` blips (e.g. drop if >8 scheduled in the last 100 ms) to avoid clipping
when boosting through a food cloud.

### 3.3 Music

Generative ambient pad, deliberately quiet (−18 dB relative to SFX):

- **menu**: two detuned triangle oscillators on a slow drone + a low-pass
  filter with an LFO. Sparse random pentatonic pluck every 3–6 s.
- **play**: same drone, brighter filter, pluck every 2–4 s, adds a soft
  sub-bass pulse at ~70 BPM.
- **king**: drone drops a fifth, pluck becomes minor-scale, pulse tightens to
  ~90 BPM and adds a filtered noise "wind" layer.
- **off**: fade out over 600 ms.

Mode switches crossfade over ~1 s. `game.js` calls `Sound.music('menu')` on
overlay show, `'play'` or `'king'` on `start()`, `'menu'` again on
`gameOver()`/`roundWin()`.

### 3.4 iOS / autoplay

`AudioContext` is created lazily inside `Sound.unlock()`, wired to the first
`pointerdown`/`touchstart`/`keydown` on `document` (once). `game.js` also
calls `Sound.unlock()` explicitly from the Play button handler so the very
first tap that starts the game also starts audio. If the context is
`suspended` on `visibilitychange` back to visible, `resume()` it.

### 3.5 Mute

HUD `#mute` button toggles `Sound.setMuted`, updates its glyph (🔊/🔇),
persists to `noodleMuted`. Also toggles with `M` on keyboard. Read the stored
value on load and apply before any sound plays.

---

## 4. Visual juice (`game.js`)

All effects are canvas 2D, allocation-light, and gated behind a single
`FX` toggle constant so they can be disabled for perf comparison.

### 4.1 Particles

One pooled array `parts` of `{x,y,vx,vy,life,max,c,r}`; updated in
`update()`, drawn in `draw()` after food and before worms. Hard cap ~400;
oldest evicted when full.

| Trigger | Burst |
|---------|-------|
| player eats pellet | 3–4 particles in pellet colour, short life (~250 ms), small |
| any worm dies (`kill()`) | 12–24 particles in worm colour scaled by `len`, longer life (~600 ms), gravity-less radial spray |
| player eats worm | additional 8 bright white/lime sparks from the head |
| round win | 60-particle confetti burst from screen centre in `PALETTE` colours, drawn in screen space (not world space) |

Particles are drawn as filled circles fading `globalAlpha` with `life/max`.

### 4.2 Screen shake

`shake = {t, mag}`; `draw()` offsets the camera translate by
`rnd(-1,1)*mag*t/T` each frame while `t>0`.

| Event | mag / duration |
|-------|----------------|
| player death | 14 px / 450 ms |
| player eats worm | `min(10, 3 + o.len/20)` px / 250 ms |
| King eaten (round-5 win) | 18 px / 600 ms |

Never shakes for rival-vs-rival kills the player didn't cause.

### 4.3 Boost trail

Currently boost draws a 25 %-alpha halo. Replace with:

- 4–6 short speed-line strokes behind the head, angled ±25° from `-ang`,
  alpha 0.5→0, length ∝ speed. Regenerated each frame (cheap).
- Keep the halo but pulse its alpha with `sin(tick/3)` so it reads as energy.
- Camera lerp factor tightens from `0.12` to `0.18` while boosting so the
  head sits slightly ahead of centre (sense of speed).

### 4.4 Pops and flashes

- **Length pop**: when `player.len` increases, `#len` gets a `.pop` class
  (CSS `transform: scale(1.35)` → `1`, 160 ms). Removed on
  `animationend`.
- **Eat-worm flash**: full-screen `rgba(255,255,255,.18)` fill for 2 frames.
- **Death flash**: `rgba(255,93,74,.35)` (coral) for 3 frames, then overlay
  fades in.
- **Round-win**: lime flash + confetti + score element `.score` scale-in via
  CSS.

### 4.5 Worm feel (small)

- Head squash on hard turns: scale head radius `×(1 + 0.15*|turnDelta|/0.11)`
  along the turn axis. Cheap, purely in `paintBody`'s head segment.
- Eyes: pupils track `steer` direction for the player (already computed as
  `s.ang`; offset by `clamp(target-ang)`).

### 4.6 Performance budget

Target: no visible drop from current frame rate on a mid-range phone with all
FX on. Particles and speed lines are plain arcs/lines — no gradients or
shadows per particle. If profiling shows a problem, reduce caps before adding
complexity (no spatial grid work in this pass; see §2.4).

---

## 5. UI/UX pass (`index.html`, `style.css`, `game.js`)

### 5.1 Overlay transitions

Replace `.hidden { display:none }` toggling with a two-state class:

- `#overlay` default: `opacity:0; transform:scale(.96); pointer-events:none;
  transition: opacity .25s, transform .25s`.
- `#overlay.show`: `opacity:1; transform:none; pointer-events:auto`.

Show/hide helpers `showOverlay(html)` / `hideOverlay()` in `game.js`
replace the scattered `classList` calls. `showOverlay` also (re)binds the
Play/Next button, calls `buildRoundPicker`/`buildSkinPicker` as needed, and
sets `Sound.music('menu')`.

Overlay content is built from three small template functions
(`titleScreen()`, `roundClearScreen()`, `gameOverScreen()`) instead of inline
template strings inside `roundWin()`/`gameOver()`.

### 5.2 HUD

- Layout per §2.2, plus the mute button (top-right, 36 px, semi-transparent
  pill; `pointer-events:auto` while the rest of the HUD stays
  `pointer-events:none`).
- `#len` pop animation (§4.4).
- Goal text stays but gets a subtle progress hint: for target rounds, tint
  `#goal` lime once `len >= target` so the player knows only "be biggest"
  remains.

### 5.3 Pause

A `⏸` button next to mute during play. Pausing sets `running=false` without
ending the run, shows a minimal overlay (`Paused` + Resume + Quit to menu),
ducks music to 40 %. Auto-pause on `visibilitychange → hidden`. Resume
restores `running=true` and music level. Quit shows `titleScreen()` (updates
`best` if exceeded, does not count as a death, does not award round progress).

### 5.4 Pickers and buttons

- Round and skin pickers keep their grid layout; add `transform:
  translateY(1px)` press state, `.sel` gets a soft glow (`box-shadow`
  using `--lime`).
- All buttons/pickers call `Sound.play('tap')` on press.
- Locked skins show a 🔒 glyph in the corner instead of only dimming, so
  "locked" vs "not selected" is unambiguous.

### 5.5 Copy and hierarchy

- Title screen `<p>` shortened; controls moved to a smaller secondary line.
- Install hint stays, already hidden in standalone mode.
- Score number on end screens animates count-up over 400 ms.

---

## 6. Testing & verification

Manual, in browser (desktop DevTools + phone-width emulation), plus a real
iOS Safari check for audio unlock and PWA update if available.

**Phase 1 (split + fixes)**
- Game plays identically to before the split.
- DevTools → Application → Local Storage shows `noodleBest`, `noodleEaten`,
  `noodleSkin`, `noodleRound` updating; values survive reload.
- HUD "Best" updates when a new best is set, across multiple rounds.
- Service worker: after bumping `CACHE`, reload twice → new files cached,
  old cache deleted. Offline reload works. Simulate a 404 (rename a file,
  reload, restore) → no 404 body in cache.

**Phase 2 (audio)**
- Each SFX fires exactly once per trigger; boost hum starts/stops with the
  button and spacebar; music switches modes on menu/play/king.
- First tap on iOS produces sound (no second-tap requirement).
- Mute persists across reload; `M` key toggles.

**Phase 3 (juice)**
- Each particle/shake/flash trigger observed; particle count never exceeds
  cap (log `parts.length` max in dev).
- Frame rate on phone emulation with CPU throttling 4× stays smooth with a
  full arena.

**Phase 4 (UI)**
- Overlay fades in/out; buttons remain tappable only when shown.
- Pause/resume/quit and auto-pause on tab hide.
- Locked skins visibly locked; tap SFX on every control.

**Regression on every phase**
- `sw.js` `CACHE` bumped once per shipped change set.
- No console errors on load or through a full 5-round run.
