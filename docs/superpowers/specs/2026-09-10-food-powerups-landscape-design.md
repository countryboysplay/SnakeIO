# Noodle Pit — Food Tiers, Power-ups, Balance & Landscape

**Date:** 2026-09-10
**Status:** Approved design, ready for implementation planning
**Builds on:** `2026-09-09-polish-and-feel-design.md` (file split, `FX`, `Sound`, tests)

## Goal

Make eating interesting (four food tiers instead of one dot), add four
player-only power-ups, rebalance round advancement so the game does not get
easier, and make the game fully playable with the phone held sideways with a
smaller joystick. Still a solo, offline, dependency-free, no-build PWA.

Out of scope: rivals using power-ups, food that moves on its own, new rounds
or skins, sound-setting changes (the iOS silent-switch behaviour stays as is,
per the user).

---

## 1. `items.js` — data + pure logic (new file, `window.Items`)

DOM-free and Node-loadable like `fx.js`. Everything tunable lives here.

```js
Items.FOOD = {
  crumb: { v: 1,  r: 3,   w: 80 },            // today's dots
  berry: { v: 3,  r: 4.5, w: 14 },
  grub:  { v: 5,  r: 5.5, w: 5  },
  apple: { v: 15, r: 7,   w: 1, max: 2 },     // golden apple, at most 2 on the arena
  chunk: { v: 2,  r: 4 },                     // dropped by dead worms — not in the spawn table
};
Items.pickFood(rand = Math.random, appleCount = 0) → kind   // weighted by w; apple → crumb when appleCount >= max
Items.avgFoodValue() → number                                // Σ(v·w)/Σw over kinds with w (≈1.62)

Items.POWERUPS = {
  speed:  { glyph: '⚡', c: '#5cc8ff', dur: 360  },   // 6 s
  shield: { glyph: '🛡', c: '#c9f24a', dur: 1200 },   // 20 s or until used
  ghost:  { glyph: '👻', c: '#e9e4ff', dur: 300  },   // 5 s
  magnet: { glyph: '🧲', c: '#ff5d4a', dur: 480  },   // 8 s
};
Items.pickPowerup(rand = Math.random) → kind                 // uniform
Items.PICKUP = { interval: [720, 1200], ttl: 1800, blinkAt: 300, minDist: 300, first: 600 }  // frames

Items.createEffects() → {
  add(kind, frames),   // (re)starts the timer; re-picking a live buff refreshes it
  has(kind) → bool,
  frac(kind) → 0..1,   // remaining fraction, 0 when inactive
  tick() → [kinds that expired this frame],
  consume(kind),       // ends it immediately, not reported as expired
  clear(),
  active() → [{ kind, frac }] in a stable order (POWERUPS key order),
}
```

All durations/intervals are frames at 60 fps (matching `fx.js`).

## 2. Food

### 2.1 Data

Food items become `{ x, y, kind, v, r, c, ph }` — `v`/`r` copied from
`Items.FOOD[kind]`, `c` a colour (palette for crumbs, fixed per kind for
others, the worm's colour for chunks), `ph` a random phase for wiggle/pulse.

`mkFood(x, y, kind, color?)` replaces `mkFood(x, y, v)`:

| Caller | Before | After |
|--------|--------|-------|
| `reset()` seeding | 350 × v1 | **260** × `Items.pickFood(Math.random, appleCount)` |
| top-up in `update()` | when `< 380`, v1 | when `< 280`, `pickFood` |
| `kill()` drops | v2 | `'chunk'` with the worm's colour |
| boost shed | v1 | `'crumb'` |

`appleCount` = number of `kind==='apple'` currently in `food` (counted when
spawning; a running counter kept in sync on spawn/eat is fine).

### 2.2 Drawing (in `draw()`, per kind — cheap 2D)

- **crumb** — today's filled circle.
- **berry** — circle in `#c9457f` with a `#ff8fc2` highlight arc and a 2 px
  dark stem.
- **grub** — three overlapping circles along a direction that wiggles with
  `sin(tick/8 + ph)`, fill `#f3e6a2`, two darker stripes.
- **apple** — `#ffd23f` circle, radial glow (`globalAlpha .25`, radius
  `r*2.2 + sin(tick/5 + ph)`), 4-point white sparkle rotating slowly.
- **chunk** — today's v2 circle.

Culling stays as today (skip when off-screen by r+20).

### 2.3 Eating

- Player: particles `3 + v/2 | 0` in `f.c`; `Sound.play('eat', v)` where the
  eat SFX now clamps pitch at `min(v, 6)`; apples additionally play
  `Sound.play('apple')`.
- Rivals: as today.
- AI targeting: `score = d² / f.v` (lower is better) instead of nearest, so
  rivals prefer richer food. Same stride-3 sampling as today.

## 3. Power-ups (player-only)

### 3.1 Pickups

`pickups = []` of `{ x, y, kind, born }`; at most one on the arena.

- Spawn when `pickups.length === 0 && tick >= nextPickupAt`: random polar
  position with `200 ≤ r ≤ ARENA-200` and distance to the player ≥
  `PICKUP.minDist` (retry up to 10 times). Then
  `nextPickupAt = tick + rnd(...PICKUP.interval)`.
- `reset()`: `pickups = []`, `nextPickupAt = tick + PICKUP.first`.
- Expire when `tick - born ≥ PICKUP.ttl` → remove and reschedule; draw
  blinking (skip every other 8-frame block) once `ttl - age < blinkAt`.
- Collect when the player's head is within `radius(player) + 14`:
  `effects.add(kind, dur)`, `FX.burst(...)` in the kind colour (14 particles),
  `Sound.play('pickup')`, remove, reschedule.
- Rivals never collide with pickups.
- Drawing: ring `strokeStyle = c`, `lineWidth 3`, radius `14 + 2·sin(tick/6)`;
  dark filled disc inside; glyph via `fillText` (`16px sans-serif`,
  `textAlign center`, `textBaseline middle`).

### 3.2 Effects (`effects = Items.createEffects()`, player only)

Applied in `update()`'s player branch and the collision loop:

| Kind | Effect | Visual tell |
|------|--------|-------------|
| speed | `sp = BASE_SPEED·2.2` regardless of boost; **no** length drain while active (boost drain also suspended) | speed lines as when boosting (pass `boost || speed` to `paintBody`) |
| shield | In `kill(s, by)`, if `s === player && effects.has('shield')`: `consume('shield')`, turn 180° (`ang += π`), `len = max(6, floor(len·0.9))`, if outside the arena pull the head to radius `ARENA-20`, `FX.shake(8, 12)` + 24-particle lime burst, `Sound.play('shieldHit')`, **return without dying** | lime ring around the head (`radius·1.9`, alpha .6) |
| ghost | Collision loop skips any pair that includes the player (both directions) | player drawn with `globalAlpha .5` |
| magnet | Each frame, every food within 140 px of the head moves 4 px toward it | faint coral ring at 140 px, alpha .12 |

`effects.tick()` runs once per `update()`; each expired kind plays
`Sound.play('buffEnd')`. `effects.clear()` in `reset()`.

### 3.3 HUD

`#buffs` is a flex item in `#hud` (after the Length block): one
`<span class="buff"><i>glyph</i><b></b></span>` per active effect, `<b>`
width = `frac·100%` (draining bar under the glyph). The pill list is rebuilt
only when the *set* of active kinds changes; widths update every 6 ticks.

### 3.4 Sound (`audio.js` additions)

| Name | Sketch |
|------|--------|
| `pickup` | two rising sines (660→990, 880→1320), 0.18 s |
| `shieldHit` | lowpass noise thud + one bell partial (1320 Hz, 0.4 s) |
| `buffEnd` | single sine 660→330, 0.2 s, quiet |
| `apple` | 3-note fast sparkle (1047, 1319, 1568), triangle, 0.12 s each |

## 4. Balance — round advancement

### 4.1 One dial

```js
const PACE = <set by the sim, start 1.5>;
const ROUNDS = [
  { target: 40,  rivals: 8,  rivalLen: [10, 25],  name: 'Hatchling' },
  { target: 80,  rivals: 10, rivalLen: [15, 45],  name: 'Hunter' },
  { target: 130, rivals: 12, rivalLen: [20, 70],  name: 'Predator' },
  { target: 200, rivals: 14, rivalLen: [30, 110], name: 'Apex' },
  { target: 0,   rivals: 10, rivalLen: [30, 90],  name: 'The Pit King', king: true },
].map(r => ({ ...r, target: Math.round(r.target * PACE), rivalLen: r.rivalLen.map(n => Math.round(n * PACE)) }));
const KING_LEN = Math.round(320 * PACE);
```

Player start length (10) and rival counts are unchanged.

### 4.2 Measure with a sim

`tools/balance-sim.mjs` (Node script, not a test) boots the real `game.js`
under `tests/dom-stub.mjs`, drives the player with a greedy autopilot
(steer to the best-scoring food using the same `d²/v` rule as rivals, turn
back when within 150 px of the wall, boost never) and, per round, reports
over N=20 runs: median frames to clear, clear rate, median death frame.

Requires a read-only debug hook in `game.js`:

```js
window.NoodleDebug = { state: () => ({ worms, food, pickups, player, round, tick, running, paused, effects }),
                       steer: a => { steer = a; }, setRound: i => { round = i; }, spawnPickup: kind => {...} };
```

Procedure: (1) add hook + sim, run on the pre-change food → **baseline**;
(2) implement food + power-ups; (3) run with `PACE=1`, then tune `PACE`
until median frames-to-clear per round is within **±15 %** of baseline; (4)
record the before/after table in this spec (section 4.4).

### 4.3 Guardrails that don't touch the dial

Apple max 2 and 1 % weight; magnet radius 140 px; one pickup at a time,
12–20 s apart (3–4 per round); shield costs 10 % length when it fires.

### 4.4 Results

*Filled in during implementation:*

| Round | Baseline median frames | New (PACE=…) | Δ |
|-------|------------------------|--------------|---|
| 1 | | | |
| 2 | | | |
| 3 | | | |
| 4 | | | |
| King | | | |

## 5. Landscape & controls

- `manifest.webmanifest`: `"orientation": "any"`.
- Joystick ring 150 → **110 px**, knob 64 → **48 px** (margin −24, clamp
  `r.width/2 − 24` in `stickPos`); boost button 78 → **66 px**, font 13 px.
- Safe areas: `#stick { left: calc(16px + env(safe-area-inset-left)) }`,
  `#boost { right: calc(16px + env(safe-area-inset-right)) }`; bottoms keep
  `env(safe-area-inset-bottom)`.
- `#overlay { overflow-y: auto }` so long content scrolls instead of being
  clipped by `body { overflow: hidden }`.
- Overlay templates wrap content in two blocks: `<div class="col main">`
  (headline, text, primary button, install hint) and `<div class="col side">`
  (round + skin pickers). Portrait: blocks stack (today's look). Landscape
  short screens — `@media (orientation: landscape) and (max-height: 500px)` —
  `#overlay { flex-direction: row; gap: 0 32px; padding: 12px 24px }`,
  `.col { max-width: 46% }`, `h1 { font-size: 34px }`, `.score { 30px }`,
  `#overlay p { margin: 12px 0 16px }`.
- HUD already wraps; `#buffs` sits inline with Length.
- Smoke test adds a landscape boot (`innerWidth 844 / innerHeight 390`).

## 6. Files

| File | Change |
|------|--------|
| `items.js` | new — §1 |
| `game.js` | food kinds, pickups, effects, HUD buffs, `NoodleDebug`, `PACE` |
| `audio.js` | 4 SFX (§3.4), `eat` pitch clamp |
| `index.html` | `#buffs`; `items.js` script tag before `game.js` |
| `style.css` | buffs pills, joystick/boost sizes, safe areas, landscape media query, `.col` |
| `manifest.webmanifest` | orientation any |
| `sw.js` | add `./items.js`; `CACHE` → `noodle-pit-v3` |
| `tools/balance-sim.mjs` | new — §4.2 |
| `tests/items.test.mjs` | weights, avg value, apple cap, effects timers/consume/expiry ordering |
| `tests/audio.test.mjs` | new SFX names create nodes |
| `tests/game.smoke.test.mjs` | via `NoodleDebug`: pickup collect → effect active + HUD pill; shield saves from wall; speed no drain; magnet pulls; landscape boot |
| `README.md` | food/power-up blurb, landscape note, sim usage |

## 7. Testing

- `node --test` green throughout; new tests as listed.
- `node tools/balance-sim.mjs` before/after; numbers recorded in §4.4.
- Phone pass (user's iPhone, both orientations, installed app): pickups
  readable at a glance, shield save feels fair, magnet visibly pulls, HUD pills
  drain, joystick comfortable, overlays fully visible sideways, round 1 still
  a warm-up, King still a fight.
