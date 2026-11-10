// Headless balance sim: runs the real game with a greedy, invincible autopilot and reports how many
// frames the player needs to reach each round's target length (King round: KING_LEN). Growth rate is
// what food tiers / power-ups / PACE change; survival is left out so the crude autopilot doesn't skew it.
// Usage: node tools/balance-sim.mjs [runs=20] [maxFrames=20000] [pace] [legacy|mortal]
//   pace   — overrides PACE in game.js
//   legacy — approximates the pre-tier game: every spawn is a crumb and no power-ups ever appear
//            (food density still follows the current 260/280 counts, so it reads slightly slower than the old 350/380)
//   mortal — no god mode: also reports how often the autopilot dies before the target, and how fast
//            (a rough difficulty read for the hybrid contact rule, not a growth measurement)
import fs from 'node:fs';
import { loadScript } from '../tests/load.mjs';
import { installDom } from '../tests/dom-stub.mjs';

const runs = +process.argv[2] || 20, maxFrames = +process.argv[3] || 20000;
if (process.argv[4]) globalThis.NOODLE_PACE = +process.argv[4];
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script'));
const dom = installDom({ html: body });
const legacy = process.argv[5] === 'legacy', mortal = process.argv[5] === 'mortal';
for (const f of ['songs.js', 'audio.js', 'fx.js', 'items.js', 'rules.js', 'sync.js']) if (fs.existsSync(new URL('../' + f, import.meta.url))) loadScript(f);
if (legacy && globalThis.Items) { globalThis.Items.pickFood = () => 'crumb'; globalThis.Items.PICKUP.first = 1e9; }
loadScript('game.js');
const D = globalThis.NoodleDebug, R = globalThis.Rules;

// Same instincts as the rivals: richest-nearest food, turn back near the wall, dodge every body ahead
// (under the hybrid rule any side is fatal; only a smaller worm's head is fair game) and the spike logs.
function autopilot() {
  const { food, player, worms, pickups = [], arenaR = 2200, logs = [] } = D.state();
  let best = Infinity, tx = null, ty = null;
  for (let i = 0; i < food.length; i += 2) { const f = food[i]; const sc = ((f.x - player.x) ** 2 + (f.y - player.y) ** 2) / (f.v || 1); if (sc < best) { best = sc; tx = f.x; ty = f.y; } }
  for (const p of pickups) { if (Math.hypot(p.x - player.x, p.y - player.y) < 450) { tx = p.x; ty = p.y; } }   // a nearby power-up beats any food
  let a = tx == null ? player.ang : Math.atan2(ty - player.y, tx - player.x);
  if (Math.hypot(player.x, player.y) > arenaR - 150) a = Math.atan2(-player.y, -player.x);
  const lx = player.x + Math.cos(player.ang) * 70, ly = player.y + Math.sin(player.ang) * 70;
  const rad = w => 5 + Math.min(10, w.len / 25);
  outer: for (const o of worms) { if (o === player || o.dead) continue;
    const hz = (rad(o) * (R ? R.HEAD_ZONE : 0)) ** 2, small = o.len < player.len;
    for (let i = 0; i < o.pts.length; i += 3) { const p = o.pts[i];
      if (small && (p.x - o.x) ** 2 + (p.y - o.y) ** 2 < hz) continue;
      if ((p.x - lx) ** 2 + (p.y - ly) ** 2 < 2500) { a = player.ang + 1.4; break outer; } } }
  if (R) for (const g of logs) if (R.segDist2(lx, ly, g.x, g.y, g.a, R.LOG.len / 2) < 60 * 60) a = player.ang + 1.4;
  D.steer(a);
}
// Frames until the player reaches the round's target length (or maxFrames). Round-clear also needs
// "biggest in the pit", which is about survival, so a clear may end the run early — that counts as reached.
function runRound(r) {
  D.setMode?.('rounds'); D.setRound(r); D.setGodMode(!mortal);
  if (D.state().deathT) dom.frame(D.state().deathT + 1);   // let a death cam finish before restarting
  dom.el('start').onclick();
  const target = D.state().target, t0 = D.state().tick;
  // count simulation ticks, not rendered frames: slow-mo after big kills runs the sim every other frame
  for (let guard = 0; guard < maxFrames * 3; guard++) {
    autopilot(); dom.frame(1);
    const st = D.state(), frames = st.tick - t0;
    if (st.player.dead) return { frames, reached: false, died: true, len: st.player.len, target };
    if (st.player.len >= target || !st.running) return { frames, reached: true, len: st.player.len, target };
    if (frames >= maxFrames) break;
  }
  return { frames: maxFrames, reached: false, len: D.state().player.len, target };
}
const median = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
console.log(`runs=${runs} maxFrames=${maxFrames} pace=${globalThis.NOODLE_PACE || 'default'}${legacy ? ' LEGACY FOOD, NO POWER-UPS' : ''}${mortal ? ' MORTAL' : ''}`);
console.log('round  target  reached%  median frames to target  median len/1000f' + (mortal ? '  died%  median frames to death' : ''));
for (let r = 0; r < 5; r++) {
  const res = []; for (let i = 0; i < runs; i++) res.push(runRound(r));
  const ok = res.filter(x => x.reached), target = res[0].target;
  const rate = median(res.map(x => (x.len - 10) / x.frames * 1000));
  const died = res.filter(x => x.died);
  console.log(`${String(r + 1).padEnd(6)} ${String(target).padEnd(7)} ${String(Math.round(100 * ok.length / runs) + '%').padEnd(9)} ${String(ok.length ? median(ok.map(x => x.frames)) : '-').padEnd(24)} ${rate.toFixed(1).padEnd(17)}` +
    (mortal ? ` ${String(Math.round(100 * died.length / runs) + '%').padEnd(6)} ${died.length ? median(died.map(x => x.frames)) : '-'}` : ''));
}
