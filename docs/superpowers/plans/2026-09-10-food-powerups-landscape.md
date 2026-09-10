# Food Tiers, Power-ups, Balance & Landscape — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four food tiers, four player-only power-ups with a buffs HUD, round targets rebalanced from measured data via one `PACE` dial, and a game that plays well with the phone sideways on a smaller joystick.

**Architecture:** New DOM-free `items.js` (`window.Items`) holds all food/power-up data, the weighted pickers and the `Effects` timer helper, tested in Node. `game.js` gains a read-only `NoodleDebug` hook used by both the smoke tests and a new headless balance sim (`tools/balance-sim.mjs`) that drives the real game with an autopilot to measure frames-to-clear before/after. Landscape is CSS + manifest + a two-column overlay template.

**Tech Stack:** Vanilla JS, Canvas 2D, Web Audio, Node 24 `node --test` (zero deps). Existing `tests/dom-stub.mjs` + `tests/load.mjs` harness.

**Spec:** `docs/superpowers/specs/2026-09-10-food-powerups-landscape-design.md`

## Global Constraints

- No build step, no npm deps, no asset files, no `type="module"` on shipped scripts.
- Script order in `index.html`: `audio.js`, `fx.js`, `items.js`, `game.js`. `items.js` assigns `window.Items` and must load in Node.
- Time unit everywhere is frames at 60 fps.
- Power-ups are player-only; rivals never collide with pickups.
- Food spawn table: crumb w80 v1 r3 · berry w14 v3 r4.5 · grub w5 v5 r5.5 · apple w1 v15 r7 max 2 · chunk v2 r4 (not spawned). Seed 260, top-up below 280.
- Power-ups: speed 360 f · shield 1200 f · ghost 300 f · magnet 480 f (radius 140 px, 4 px/frame). Pickups: interval 720–1200 f, ttl 1800 f, blink last 300 f, min 300 px from player, first at +600 f, one at a time.
- `PACE` scales round targets, rival length ranges and `KING_LEN`; chosen so median frames-to-clear per round is within ±15 % of the baseline measured in Task 1.
- `sw.js`: add `./items.js`; `CACHE` → `noodle-pit-v3`.
- Commit each task with trailer:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01D1cdBkAH34VGswPpCV6FYm
  ```
- Tests: `node --test` from repo root. Sim: `node tools/balance-sim.mjs [runs] [maxFrames]`.

---

### Task 1: `NoodleDebug` hook + balance sim + baseline

**Files:**
- Modify: `game.js` (before the final `reset(); showOverlay(titleScreen()); loop();` line)
- Create: `tools/balance-sim.mjs`
- Modify: `docs/superpowers/specs/2026-09-10-food-powerups-landscape-design.md` §4.4 (baseline column)

**Interfaces:**
- Produces `window.NoodleDebug = { state(), steer(a), setRound(i) }` where `state()` returns `{ worms, food, player, round, tick, running, paused }`. Task 4 extends `state()` with `pickups, effects` and adds `spawnPickup(kind)`.

- [ ] **Step 1: Add the hook** — insert before `reset(); showOverlay(titleScreen()); loop();`:

```js
// read-only debug hook for the headless smoke tests and tools/balance-sim.mjs
window.NoodleDebug = {
  state: () => ({ worms, food, player, round, tick, running, paused }),
  steer: a => { steer = a; },
  setRound: i => { round = i; },
};
```

- [ ] **Step 2: Write the sim** — `tools/balance-sim.mjs`:

```js
// Headless balance sim: runs the real game with a greedy autopilot and reports frames-to-clear per round.
// Usage: node tools/balance-sim.mjs [runs=20] [maxFrames=20000]
import fs from 'node:fs';
import { loadScript } from '../tests/load.mjs';
import { installDom } from '../tests/dom-stub.mjs';

const runs = +process.argv[2] || 20, maxFrames = +process.argv[3] || 20000;
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script'));
const dom = installDom({ html: body });
for (const f of ['audio.js', 'fx.js', 'items.js', 'game.js']) if (fs.existsSync(new URL('../' + f, import.meta.url))) loadScript(f);
const D = globalThis.NoodleDebug, ARENA = 2200;

// Same instincts as the rivals: richest-nearest food, turn back near the wall, dodge bigger bodies ahead.
function autopilot() {
  const { food, player, worms } = D.state();
  let best = Infinity, tx = null, ty = null;
  for (let i = 0; i < food.length; i += 2) { const f = food[i]; const sc = ((f.x - player.x) ** 2 + (f.y - player.y) ** 2) / (f.v || 1); if (sc < best) { best = sc; tx = f.x; ty = f.y; } }
  let a = tx == null ? player.ang : Math.atan2(ty - player.y, tx - player.x);
  if (Math.hypot(player.x, player.y) > ARENA - 150) a = Math.atan2(-player.y, -player.x);
  const lx = player.x + Math.cos(player.ang) * 70, ly = player.y + Math.sin(player.ang) * 70;
  outer: for (const o of worms) { if (o === player || o.dead || o.len < player.len) continue;
    for (let i = 0; i < o.pts.length; i += 3) { const p = o.pts[i]; if ((p.x - lx) ** 2 + (p.y - ly) ** 2 < 2500) { a = player.ang + 1.4; break outer; } } }
  D.steer(a);
}
function runRound(r) {
  D.setRound(r);
  dom.el('start').onclick();
  for (let frames = 1; frames <= maxFrames; frames++) {
    autopilot(); dom.frame(1);
    if (!D.state().running) return { frames, won: /Round cleared|You rule/.test(dom.el('overlay').innerHTML) };
  }
  return { frames: maxFrames, won: false };
}
const median = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
console.log(`runs=${runs} maxFrames=${maxFrames}`);
console.log('round  clear%  median clear frames  median death frame');
for (let r = 0; r < 5; r++) {
  const res = []; for (let i = 0; i < runs; i++) res.push(runRound(r));
  const wins = res.filter(x => x.won), deaths = res.filter(x => !x.won);
  console.log(`${String(r + 1).padEnd(6)} ${String(Math.round(100 * wins.length / runs) + '%').padEnd(7)} ${String(wins.length ? median(wins.map(x => x.frames)) : '-').padEnd(20)} ${deaths.length ? median(deaths.map(x => x.frames)) : '-'}`);
}
```

- [ ] **Step 3: Run baseline** — `node --check game.js && node --test` (green, 27) then `node tools/balance-sim.mjs 20`. Paste the table into spec §4.4 "Baseline" column (frames; note clear %).

- [ ] **Step 4: Commit**

```bash
git add game.js tools/balance-sim.mjs docs/superpowers/specs/2026-09-10-food-powerups-landscape-design.md
git commit -m "chore: NoodleDebug hook and headless balance sim; record baseline pace"
```

---

### Task 2: `items.js` (TDD)

**Files:**
- Create: `items.js`, `tests/items.test.mjs`
- Modify: `index.html` (script tag), `sw.js` (asset + `CACHE`)

**Interfaces:** Produces `window.Items` exactly as spec §1: `FOOD`, `pickFood(rand, appleCount)`, `avgFoodValue()`, `POWERUPS`, `pickPowerup(rand)`, `PICKUP`, `createEffects()` → `{ add, has, frac, tick, consume, clear, active }`.

- [ ] **Step 1: Failing tests** — `tests/items.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from './load.mjs';
loadScript('items.js');
const Items = globalThis.Items;

test('food table: spawn weights sum to 100, avg value ≈ 1.62, chunk is not spawnable', () => {
  const spawnable = Object.entries(Items.FOOD).filter(([, k]) => k.w);
  assert.equal(spawnable.reduce((s, [, k]) => s + k.w, 0), 100);
  assert.ok(Math.abs(Items.avgFoodValue() - 1.62) < 0.01, `avg ${Items.avgFoodValue()}`);
  assert.equal(Items.FOOD.chunk.w, undefined);
});

test('pickFood is weighted and honours the apple cap', () => {
  const seq = [0.0, 0.5, 0.799, 0.8, 0.93, 0.94, 0.989, 0.99, 0.999];
  const out = seq.map(x => Items.pickFood(() => x));
  assert.deepEqual(out, ['crumb', 'crumb', 'crumb', 'berry', 'berry', 'grub', 'grub', 'apple', 'apple']);
  assert.equal(Items.pickFood(() => 0.995, 2), 'crumb', 'apple → crumb when 2 apples already exist');
  assert.equal(Items.pickFood(() => 0.995, 1), 'apple');
});

test('pickPowerup covers all kinds uniformly', () => {
  const kinds = Object.keys(Items.POWERUPS);
  assert.deepEqual(kinds, ['speed', 'shield', 'ghost', 'magnet']);
  assert.deepEqual(kinds.map((_, i) => Items.pickPowerup(() => (i + 0.5) / kinds.length)), kinds);
});

test('effects: add/has/frac/tick/expire ordering', () => {
  const e = Items.createEffects();
  assert.equal(e.has('speed'), false); assert.equal(e.frac('speed'), 0); assert.deepEqual(e.active(), []);
  e.add('speed', 4); e.add('magnet', 2);
  assert.ok(e.has('speed') && e.has('magnet'));
  assert.equal(e.frac('speed'), 1);
  assert.deepEqual(e.active().map(a => a.kind), ['speed', 'magnet'], 'stable POWERUPS order');
  assert.deepEqual(e.tick(), []);          // 3 / 1 left
  assert.equal(e.frac('speed'), 0.75);
  assert.deepEqual(e.tick(), ['magnet']);  // magnet hits 0 → reported once
  assert.equal(e.has('magnet'), false);
  assert.deepEqual(e.tick(), []);
  assert.deepEqual(e.tick(), ['speed']);
  assert.equal(e.has('speed'), false);
});

test('effects: re-adding refreshes, consume ends silently, clear wipes', () => {
  const e = Items.createEffects();
  e.add('shield', 2); e.tick(); e.add('shield', 5);
  assert.equal(e.frac('shield'), 1, 'refreshed to full');
  e.consume('shield');
  assert.equal(e.has('shield'), false);
  assert.deepEqual(e.tick(), [], 'consumed buffs are not reported as expired');
  e.add('ghost', 9); e.clear();
  assert.deepEqual(e.active(), []);
});
```

- [ ] **Step 2: Run** `node --test tests/items.test.mjs` → all fail (`Items` undefined).

- [ ] **Step 3: Implement `items.js`**

```js
// Noodle Pit item data — food tiers, power-ups, effect timers. Pure data + logic, no DOM. Frames at 60 fps.
(() => {
  const FOOD = {
    crumb: { v: 1,  r: 3,   w: 80 },
    berry: { v: 3,  r: 4.5, w: 14 },
    grub:  { v: 5,  r: 5.5, w: 5  },
    apple: { v: 15, r: 7,   w: 1, max: 2 },
    chunk: { v: 2,  r: 4 },
  };
  const SPAWN = Object.entries(FOOD).filter(([, k]) => k.w);
  const TOTAL_W = SPAWN.reduce((s, [, k]) => s + k.w, 0);
  function pickFood(rand = Math.random, appleCount = 0) {
    let x = rand() * TOTAL_W;
    for (const [name, k] of SPAWN) { if (x < k.w) return name === 'apple' && appleCount >= FOOD.apple.max ? 'crumb' : name; x -= k.w; }
    return 'crumb';
  }
  function avgFoodValue() { return SPAWN.reduce((s, [, k]) => s + k.v * k.w, 0) / TOTAL_W; }

  const POWERUPS = {
    speed:  { glyph: '⚡', c: '#5cc8ff', dur: 360  },
    shield: { glyph: '🛡', c: '#c9f24a', dur: 1200 },
    ghost:  { glyph: '👻', c: '#e9e4ff', dur: 300  },
    magnet: { glyph: '🧲', c: '#ff5d4a', dur: 480  },
  };
  const KINDS = Object.keys(POWERUPS);
  function pickPowerup(rand = Math.random) { return KINDS[Math.min(KINDS.length - 1, rand() * KINDS.length | 0)]; }
  const PICKUP = { interval: [720, 1200], ttl: 1800, blinkAt: 300, minDist: 300, first: 600 };

  function createEffects() {
    const t = {};   // kind -> { left, total }
    return {
      add(kind, frames) { t[kind] = { left: frames, total: frames }; },
      has(kind) { return !!t[kind]; },
      frac(kind) { return t[kind] ? t[kind].left / t[kind].total : 0; },
      tick() { const out = []; for (const k of KINDS) { const e = t[k]; if (!e) continue; if (--e.left <= 0) { delete t[k]; out.push(k); } } return out; },
      consume(kind) { delete t[kind]; },
      clear() { for (const k of Object.keys(t)) delete t[k]; },
      active() { return KINDS.filter(k => t[k]).map(k => ({ kind: k, frac: t[k].left / t[k].total })); },
    };
  }
  (typeof window !== 'undefined' ? window : globalThis).Items = { FOOD, pickFood, avgFoodValue, POWERUPS, pickPowerup, PICKUP, createEffects };
})();
```

- [ ] **Step 4: Wire it in** — `index.html`: add `<script src="items.js"></script>` between `fx.js` and `game.js`. `sw.js`: `CACHE = 'noodle-pit-v3'` and add `'./items.js'` after `'./fx.js'` in `ASSETS`. In `tests/game.smoke.test.mjs` and `tools/balance-sim.mjs` load `items.js` before `game.js` (the sim already does).

- [ ] **Step 5: Run** `node --test` → green. **Commit:** `git add items.js tests/items.test.mjs index.html sw.js tests/game.smoke.test.mjs` / `feat(items): food tiers, power-up table and effect timers`.

---

### Task 3: Food tiers in the game

**Files:** Modify `game.js`, `audio.js`, `tests/game.smoke.test.mjs`.

**Interfaces:** Consumes `Items.FOOD`, `Items.pickFood`. Produces `mkFood(x, y, kind, color?)`, `spawnFood()`, `eatFood(i)`, `appleCount`, `drawFood(f)`.

- [ ] **Step 1: Data** — replace `mkFood`:

```js
const FOOD_COLORS = { berry:'#c9457f', grub:'#f3e6a2', apple:'#ffd23f' };
let appleCount = 0;
function mkFood(x,y,kind,color){
  if(food.length>900) return;
  kind = kind || 'crumb'; const k = Items.FOOD[kind];
  if (kind==='apple') appleCount++;
  food.push({ x, y, kind, v: k.v, r: k.r, c: color || FOOD_COLORS[kind] || PALETTE[Math.random()*PALETTE.length|0], ph: Math.random()*Math.PI*2 });
}
function spawnFood(){ const a=rnd(0,Math.PI*2), r=Math.sqrt(Math.random())*(ARENA-30); mkFood(Math.cos(a)*r, Math.sin(a)*r, Items.pickFood(Math.random, appleCount)); }
function eatFood(i){ const f=food[i]; if (f.kind==='apple') appleCount--; food.splice(i,1); return f; }
```

Callers: `reset()` → `appleCount = 0;` next to `food = [];` and seeding loop → `for (let i=0;i<260;i++) spawnFood();`. Top-up → `if (food.length < 280 && tick%4===0) spawnFood();`. `kill()` drops → `mkFood(p.x+rnd(-4,4), p.y+rnd(-4,4), 'chunk', s.c)`. Boost shed → `mkFood(t.x,t.y,'crumb')`.

- [ ] **Step 2: Eating + AI** — eat loop body:

```js
if((f.x-s.x)**2+(f.y-s.y)**2 < r*r){ s.len += f.v; if (s===player){ FX.burst(f.x, f.y, 3 + (f.v/2|0), f.c, { speed: 1.8 + f.v*0.15, life: 15, r: 1.8 }); Sound.play('eat', f.v); if (f.kind==='apple') Sound.play('apple'); } eatFood(i); }
```
AI food scoring: `const d=((food[i].x-s.x)**2+(food[i].y-s.y)**2)/food[i].v;` (comment: `// richest-nearest food`).

- [ ] **Step 3: Drawing** — add `drawFood` (spec §2.2) and change the food loop to `for (const f of food){ if(Math.abs(f.x-cam.x)>W/2+20||Math.abs(f.y-cam.y)>H/2+20) continue; drawFood(f); }`:

```js
function drawFood(f){
  switch (f.kind){
    case 'berry':
      ctx.fillStyle=f.c; ctx.beginPath(); ctx.arc(f.x,f.y,f.r,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle='#ff8fc2'; ctx.lineWidth=1.5; ctx.beginPath(); ctx.arc(f.x-f.r*.2,f.y-f.r*.2,f.r*.55,Math.PI*1.1,Math.PI*1.7); ctx.stroke();
      ctx.strokeStyle='#4a7a2a'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(f.x,f.y-f.r); ctx.lineTo(f.x+2,f.y-f.r-4); ctx.stroke();
      break;
    case 'grub': {
      const a=Math.sin(tick/8+f.ph)*0.6, dx=Math.cos(a)*f.r*.7, dy=Math.sin(a)*f.r*.7;
      ctx.fillStyle=f.c; for (let k=-1;k<=1;k++){ ctx.beginPath(); ctx.arc(f.x+dx*k,f.y+dy*k,f.r*(k?.75:.85),0,Math.PI*2); ctx.fill(); }
      ctx.strokeStyle='rgba(120,90,20,.5)'; ctx.lineWidth=1.5; for (const k of [-0.5,0.5]){ ctx.beginPath(); ctx.arc(f.x+dx*k,f.y+dy*k,f.r*.7,0,Math.PI*2); ctx.stroke(); }
      break; }
    case 'apple': {
      ctx.globalAlpha=.25; ctx.fillStyle=f.c; ctx.beginPath(); ctx.arc(f.x,f.y,f.r*2.2+Math.sin(tick/5+f.ph)*1.5,0,Math.PI*2); ctx.fill(); ctx.globalAlpha=1;
      ctx.fillStyle=f.c; ctx.beginPath(); ctx.arc(f.x,f.y,f.r,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='rgba(255,255,255,.5)'; ctx.beginPath(); ctx.arc(f.x-f.r*.3,f.y-f.r*.3,f.r*.3,0,Math.PI*2); ctx.fill();
      const sa=tick/40+f.ph, sx=f.x+f.r*1.3, sy=f.y-f.r*1.3; ctx.strokeStyle='#fff'; ctx.lineWidth=1.5; ctx.beginPath();
      for (let k=0;k<2;k++){ const b=sa+k*Math.PI/2; ctx.moveTo(sx-Math.cos(b)*4,sy-Math.sin(b)*4); ctx.lineTo(sx+Math.cos(b)*4,sy+Math.sin(b)*4); } ctx.stroke();
      break; }
    default: ctx.fillStyle=f.c; ctx.beginPath(); ctx.arc(f.x,f.y,f.r,0,Math.PI*2); ctx.fill();
  }
}
```

- [ ] **Step 4: Audio** — in `audio.js` `SFX.eat`: `const q = Math.min(v, 6);` and use `q` in both frequencies. Add `apple() { const t = now(); [1047, 1319, 1568].forEach((f, i) => osc('triangle', f, t + i * 0.06, 0.12, sfxBus, 0.25)); },`. Add `'apple'` to the SFX-name loop in `tests/audio.test.mjs`.

- [ ] **Step 5: Smoke assertion** — in the "starts a round" test after the frames: `const kinds = new Set(globalThis.NoodleDebug.state().food.map(f => f.kind)); assert.ok(kinds.has('crumb') && kinds.has('berry'), 'food has tiers');` and `assert.ok(globalThis.NoodleDebug.state().food.filter(f => f.kind === 'apple').length <= 2, 'apple cap');`.

- [ ] **Step 6: Run** `node --check game.js && node --test` → green. **Commit:** `feat: food tiers — crumbs, berries, grubs, golden apples; rivals prefer rich food`.

---

### Task 4: Power-ups, effects, HUD buffs, SFX

**Files:** Modify `game.js`, `audio.js`, `index.html`, `style.css`, `tests/audio.test.mjs`, `tests/game.smoke.test.mjs`.

**Interfaces:** Consumes `Items.POWERUPS/PICKUP/pickPowerup/createEffects`. Produces `pickups`, `effects`, `spawnPickup(kind?, x?, y?)`, `schedulePickup()`, `shieldSave()`, `renderBuffs(force?)`; `NoodleDebug.state()` gains `pickups, effects`; `NoodleDebug.spawnPickup(kind)` drops one at the player's head.

- [ ] **Step 1: State + spawning** — after `let playerHitWall = false;`:

```js
let pickups = [], nextPickupAt = 0;
const effects = Items.createEffects();
function schedulePickup(){ nextPickupAt = tick + rnd(Items.PICKUP.interval[0], Items.PICKUP.interval[1]); }
function spawnPickup(kind, x, y){
  if (x==null){ for (let t=0;t<10;t++){ const a=rnd(0,Math.PI*2), r=rnd(200,ARENA-200); x=Math.cos(a)*r; y=Math.sin(a)*r; if (Math.hypot(x-player.x,y-player.y)>=Items.PICKUP.minDist) break; } }
  pickups.push({ x, y, kind: kind || Items.pickPowerup(), born: tick });
}
function shieldSave(){
  effects.consume('shield'); playerHitWall = false;
  player.ang += Math.PI; player.len = Math.max(6, Math.floor(player.len*0.9));
  const d = Math.hypot(player.x,player.y); if (d > ARENA-20){ player.x *= (ARENA-20)/d; player.y *= (ARENA-20)/d; }
  FX.shake(8,12); FX.burst(player.x,player.y,24,'#c9f24a',{speed:4,life:24,r:2.5}); Sound.play('shieldHit');
}
```
`reset()`: add `pickups = []; effects.clear(); nextPickupAt = tick + Items.PICKUP.first; renderBuffs(true);`.
`kill(s, by)`: first line `if (s===player && effects.has('shield')){ shieldSave(); return; }`.

- [ ] **Step 2: Update loop** — after the respawn loop at the top of `update()`:

```js
  // power-up pickups: one on the arena at a time
  if (!pickups.length && tick >= nextPickupAt) spawnPickup();
  for (let i=pickups.length-1;i>=0;i--){ const p=pickups[i];
    if (tick - p.born >= Items.PICKUP.ttl){ pickups.splice(i,1); schedulePickup(); continue; }
    const rr = radius(player)+14;
    if (!player.dead && (p.x-player.x)**2+(p.y-player.y)**2 < rr*rr){
      const P = Items.POWERUPS[p.kind]; effects.add(p.kind, P.dur);
      FX.burst(p.x,p.y,14,P.c,{speed:4,life:30,r:2.5}); Sound.play('pickup'); pickups.splice(i,1); schedulePickup();
    }
  }
  for (const k of effects.tick()) Sound.play('buffEnd');
  if (effects.has('magnet')){ for (const f of food){ const dx=player.x-f.x, dy=player.y-f.y, d=Math.hypot(dx,dy); if (d<140 && d>1){ f.x += dx/d*4; f.y += dy/d*4; } } }
```
Speed: replace `const sp = BASE_SPEED * (s.boost ? 2.2 : 1);` and the drain line with
```js
    const speedBuff = s===player && effects.has('speed');
    const sp = BASE_SPEED * (s.boost || speedBuff ? 2.2 : 1);
    if (s.boost && !speedBuff && tick%10===0 && s.len>6){ s.len--; const t=s.pts[s.pts.length-1]; mkFood(t.x,t.y,'crumb'); }
```
Ghost: in the collision section, before `for (const s of worms){`, add `const ghost = effects.has('ghost');`, and inside the inner loop change `if (o===s||o.dead) continue;` to `if (o===s||o.dead||(ghost&&(s===player||o===player))) continue;`.
End of `update()`: `renderBuffs();`.

- [ ] **Step 3: Drawing** — after the food loop, before `FX.drawWorld(ctx);`:

```js
  for (const p of pickups){
    if (Items.PICKUP.ttl-(tick-p.born) < Items.PICKUP.blinkAt && (tick>>3)&1) continue;
    if(Math.abs(p.x-cam.x)>W/2+30||Math.abs(p.y-cam.y)>H/2+30) continue;
    const P=Items.POWERUPS[p.kind], R=14+2*Math.sin(tick/6);
    ctx.fillStyle='rgba(27,19,48,.85)'; ctx.beginPath(); ctx.arc(p.x,p.y,R,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle=P.c; ctx.lineWidth=3; ctx.stroke();
    ctx.font='16px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillStyle='#fff'; ctx.fillText(P.glyph,p.x,p.y+1); ctx.textBaseline='alphabetic';
  }
```
In the worm loop: before `paintBody(...)` add `if (s===player && effects.has('ghost')) ctx.globalAlpha=.5;`; change the call's boost arg to `s.boost || (s===player && effects.has('speed'))`; after the pupils `ctx.fill();` add
```js
    if (s===player){
      ctx.globalAlpha=1;
      if (effects.has('shield')){ ctx.strokeStyle='rgba(201,242,74,.6)'; ctx.lineWidth=3; ctx.beginPath(); ctx.arc(s.x,s.y,r*1.9,0,Math.PI*2); ctx.stroke(); }
      if (effects.has('magnet')){ ctx.strokeStyle='rgba(255,93,74,.12)'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(s.x,s.y,140,0,Math.PI*2); ctx.stroke(); }
    }
```

- [ ] **Step 4: HUD** — `index.html` after the Length div: `<div id="buffs"></div>`. `game.js` (near `lenPop`):

```js
const buffsEl = document.getElementById('buffs'); let buffKeys = '';
function renderBuffs(force){
  const act = effects.active(), keys = act.map(a=>a.kind).join(',');
  if (force || keys !== buffKeys){ buffKeys = keys; buffsEl.innerHTML = act.map(a=>`<span class="buff" style="--c:${Items.POWERUPS[a.kind].c}"><i>${Items.POWERUPS[a.kind].glyph}</i><b class="bar"></b></span>`).join(''); }
  if (force || tick%6===0){ const bars = buffsEl.querySelectorAll('.bar'); act.forEach((a,i)=>{ if (bars[i]) bars[i].style.width = Math.round(a.frac*100)+'%'; }); }
}
```
(`effects` is declared later in the file but only used at call time — fine.) `style.css`:
```css
  #buffs { display:flex; gap:6px; }
  .buff { position:relative; width:30px; height:30px; border-radius:10px; background:rgba(255,255,255,.14); display:flex; align-items:center; justify-content:center; font-size:16px; overflow:hidden; }
  .buff i { font-style:normal; position:relative; z-index:1; }
  .buff .bar { position:absolute; left:0; bottom:0; height:4px; background:var(--c); width:100%; transition:width .1s linear; }
```

- [ ] **Step 5: SFX** — `audio.js` add to `SFX`:
```js
    pickup() { const t = now(); osc('sine', 660, t, 0.18, sfxBus, 0.3, { to: 990 }); osc('sine', 880, t + 0.04, 0.18, sfxBus, 0.25, { to: 1320 }); },
    shieldHit() { const t = now(); noise(t, 0.15, sfxBus, 0.5, 'lowpass', 400); osc('sine', 1320, t + 0.02, 0.4, sfxBus, 0.25); },
    buffEnd() { osc('sine', 660, now(), 0.2, sfxBus, 0.15, { to: 330 }); },
```
Add `'pickup', 'shieldHit', 'buffEnd'` to the audio test's name loop.

- [ ] **Step 6: Debug hook** — `state` adds `pickups, effects`; add `spawnPickup: kind => spawnPickup(kind, player.x, player.y),`.

- [ ] **Step 7: Smoke test** — append to `tests/game.smoke.test.mjs`:

```js
test('power-ups: collect → effect + HUD pill; magnet pulls; speed suspends drain; shield survives the wall', () => {
  const D = globalThis.NoodleDebug;
  dom.el('start').onclick(); dom.frame(2);
  D.spawnPickup('magnet'); dom.frame(1);
  let st = D.state();
  assert.ok(st.effects.has('magnet'), 'pickup at the head is collected next frame');
  assert.ok(dom.el('buffs').innerHTML.includes('🧲'), 'HUD shows the buff');
  st.food.push({ x: st.player.x + 100, y: st.player.y, kind: 'crumb', v: 1, r: 3, c: '#fff', ph: 0 });
  const f = st.food[st.food.length - 1], d0 = Math.hypot(f.x - st.player.x, f.y - st.player.y);
  dom.frame(3);
  assert.ok(Math.hypot(f.x - D.state().player.x, f.y - D.state().player.y) < d0, 'magnet pulls food toward the head');
  D.spawnPickup('speed'); dom.frame(1); assert.ok(D.state().effects.has('speed'));
  const len0 = D.state().player.len;
  dom.fireWindow('keydown', { code: 'Space' }); dom.frame(20); dom.fireWindow('keyup', { code: 'Space' });
  assert.ok(D.state().player.len >= len0, 'speed buff suspends boost drain');
  D.spawnPickup('shield'); dom.frame(1); assert.ok(D.state().effects.has('shield'));
  const p = D.state().player; p.x = 2190; p.y = 0; p.ang = 0; D.steer(0); dom.frame(6);
  st = D.state();
  assert.equal(st.player.dead, false, 'shield saves from the wall');
  assert.equal(st.effects.has('shield'), false, 'shield is consumed');
  assert.ok(Math.hypot(st.player.x, st.player.y) <= 2200 && st.running, 'player is back inside and still running');
  dom.fireWindow('keydown', { code: 'KeyP' }); dom.el('quit').onclick(); dom.frame(2);
});
```

- [ ] **Step 8: Run** `node --check game.js && node --test` (3×) → green. **Commit:** `feat: power-ups — speed, shield, ghost, magnet pickups with buffs HUD and SFX`.

---

### Task 5: Balance — set `PACE` from the sim

**Files:** Modify `game.js` (`ROUNDS`, `KING_LEN`), spec §4.4.

- [ ] **Step 1: Dial** — replace the `ROUNDS` array and `KING_LEN`:

```js
// PACE scales targets, rival sizes and the King so richer food + power-ups don't make rounds shorter (see spec §4)
const PACE = 1.5;
const ROUNDS = [
  {target:40,  rivals:8,  rivalLen:[10,25],  name:'Hatchling'},
  {target:80,  rivals:10, rivalLen:[15,45],  name:'Hunter'},
  {target:130, rivals:12, rivalLen:[20,70],  name:'Predator'},
  {target:200, rivals:14, rivalLen:[30,110], name:'Apex'},
  {target:0,   rivals:10, rivalLen:[30,90],  name:'The Pit King', king:true},
].map(r => ({ ...r, target: Math.round(r.target*PACE), rivalLen: r.rivalLen.map(n => Math.round(n*PACE)) }));
const KING_LEN = Math.round(320*PACE);
```

- [ ] **Step 2: Measure** — `node tools/balance-sim.mjs 20` with `PACE=1` first (to see the raw speed-up), then `1.5`; adjust in 0.1 steps until each round's median clear frames is within ±15 % of the Task 1 baseline (round 1 may run slightly *longer* than baseline rather than shorter). Record all columns in spec §4.4 with the chosen `PACE`.

- [ ] **Step 3: Run** `node --test` → green (the smoke tests don't depend on targets). **Commit:** `balance: PACE dial for round targets; sim results recorded`.

---

### Task 6: Landscape + controls

**Files:** Modify `manifest.webmanifest`, `style.css`, `game.js` (templates + `stickPos`), `tests/dom-stub.mjs`; create `tests/game.landscape.test.mjs`.

- [ ] **Step 1: Manifest** — `"orientation": "any"`.

- [ ] **Step 2: CSS** — in `style.css`:
  - `#boost`: `right:calc(16px + env(safe-area-inset-right, 0)); width:66px; height:66px; font-size:13px;`
  - `#stick`: `left:calc(16px + env(safe-area-inset-left, 0)); width:110px; height:110px;`
  - `#knob`: `width:48px; height:48px; margin:-24px 0 0 -24px;`
  - `#overlay`: append `overflow-y:auto; -webkit-overflow-scrolling:touch;`
  - add:
```css
  .col { display:flex; flex-direction:column; align-items:center; }
  @media (orientation: landscape) and (max-height: 500px) {
    #overlay { flex-direction:row; flex-wrap:wrap; gap:0 32px; padding:12px 24px; }
    .col { max-width:46%; }
    #overlay h1 { font-size:34px; }
    #overlay h1 span { font-size:16px; margin-top:6px; }
    #overlay .score { font-size:30px; }
    #overlay p { margin:12px 0 16px; }
    #skins { max-width:300px; }
  }
```
  - `game.js` `stickPos`: `const m=Math.min(d,r.width/2-24);`

- [ ] **Step 3: Templates** — wrap in `.col` blocks:
  - `titleScreen`: `<div class="col main">` h1, p, p.sub, `#start`, install hint `</div><div class="col side"><div id="rounds"></div><div id="skins"></div></div>`
  - `roundClearScreen` / `winScreen`: main = h1, score, p, button; side = `<div id="skins"></div>`
  - `gameOverScreen`: main = h1, score, p, button; side = rounds + skins
  - `pauseScreen`: everything in one `.col main`.

- [ ] **Step 4: Landscape smoke** — `tests/dom-stub.mjs` `installDom({ html = '', width = 390, height = 844 } = {})` and use them for `innerWidth/innerHeight`. New `tests/game.landscape.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadScript } from './load.mjs';
import { installDom } from './dom-stub.mjs';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const dom = installDom({ html: html.slice(html.indexOf('<body>') + 6, html.indexOf('<script')), width: 844, height: 390 });
for (const f of ['audio.js', 'fx.js', 'items.js', 'game.js']) loadScript(f);

test('boots and plays in landscape (844×390) without errors; overlay uses column blocks', () => {
  dom.frame(10);
  assert.ok(dom.el('overlay').innerHTML.includes('class="col main"') && dom.el('overlay').innerHTML.includes('class="col side"'));
  dom.el('start').onclick();
  dom.el('stick').dispatch('mousedown', { clientX: 120, clientY: 300 });
  dom.frame(300);
  assert.ok(Number.isFinite(+dom.el('len').textContent));
});
```

- [ ] **Step 5: Run** `node --test` → green. **Commit:** `feat: landscape play — orientation any, smaller joystick, two-column overlays, safe areas`.

---

### Task 7: README, regression, PR

- [ ] **Step 1: README** — under Controls add: "Food comes in tiers — crumbs (1), berries (3), grubs (5) and rare golden apples (15). Power-ups appear one at a time: ⚡ speed (no boost cost), 🛡 shield (survive one hit), 👻 ghost (pass through worms), 🧲 magnet (pull nearby food). Play portrait or landscape." Under Development add: "Balance sim: `node tools/balance-sim.mjs 20` prints frames-to-clear per round; tune `PACE` in `game.js`."
- [ ] **Step 2: Regression** — `node --check game.js audio.js items.js && node --test` ×3 green; `grep -n "noodle-pit-v3" sw.js`.
- [ ] **Step 3: Commit + PR** — `docs: README for food tiers, power-ups, landscape and the balance sim`; `git push -u origin food-and-powerups`; `gh pr create --base main` with summary + test plan (browser/phone checks listed as unchecked).

---

## Self-review

- Spec §1→T2, §2→T3, §3→T4, §4→T1+T5, §5→T6, §6/§7→T2/T7 + each task's run step. Sound-setting exclusion respected.
- Names: `mkFood(x,y,kind,color)`, `spawnFood`, `eatFood`, `appleCount`, `drawFood`, `pickups`, `nextPickupAt`, `effects`, `spawnPickup`, `schedulePickup`, `shieldSave`, `renderBuffs`, `buffsEl`, `NoodleDebug.{state,steer,setRound,spawnPickup}`, `Items.*` — consistent across tasks.
- `renderBuffs` references `effects` (declared later) only at call time; `reset()` calls `renderBuffs(true)` after `effects` exists because `reset()` runs at the end of the file.
