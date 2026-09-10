// Headless balance sim: runs the real game with a greedy, invincible autopilot and reports how many
// frames the player needs to reach each round's target length (King round: KING_LEN). Growth rate is
// what food tiers / power-ups / PACE change; survival is left out so the crude autopilot doesn't skew it.
// Usage: node tools/balance-sim.mjs [runs=20] [maxFrames=20000] [pace]   (pace overrides PACE in game.js)
import fs from 'node:fs';
import { loadScript } from '../tests/load.mjs';
import { installDom } from '../tests/dom-stub.mjs';

const runs = +process.argv[2] || 20, maxFrames = +process.argv[3] || 20000;
if (process.argv[4]) globalThis.NOODLE_PACE = +process.argv[4];
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script'));
const dom = installDom({ html: body });
for (const f of ['audio.js', 'fx.js', 'items.js', 'game.js']) if (fs.existsSync(new URL('../' + f, import.meta.url))) loadScript(f);
const D = globalThis.NoodleDebug, ARENA = 2200;

// Same instincts as the rivals: richest-nearest food, turn back near the wall, dodge bigger bodies ahead.
function autopilot() {
  const { food, player, worms, pickups = [] } = D.state();
  let best = Infinity, tx = null, ty = null;
  for (let i = 0; i < food.length; i += 2) { const f = food[i]; const sc = ((f.x - player.x) ** 2 + (f.y - player.y) ** 2) / (f.v || 1); if (sc < best) { best = sc; tx = f.x; ty = f.y; } }
  for (const p of pickups) { if (Math.hypot(p.x - player.x, p.y - player.y) < 450) { tx = p.x; ty = p.y; } }   // a nearby power-up beats any food
  let a = tx == null ? player.ang : Math.atan2(ty - player.y, tx - player.x);
  if (Math.hypot(player.x, player.y) > ARENA - 150) a = Math.atan2(-player.y, -player.x);
  const lx = player.x + Math.cos(player.ang) * 70, ly = player.y + Math.sin(player.ang) * 70;
  outer: for (const o of worms) { if (o === player || o.dead || o.len < player.len) continue;
    for (let i = 0; i < o.pts.length; i += 3) { const p = o.pts[i]; if ((p.x - lx) ** 2 + (p.y - ly) ** 2 < 2500) { a = player.ang + 1.4; break outer; } } }
  D.steer(a);
}
// Frames until the player reaches the round's target length (or maxFrames). Round-clear also needs
// "biggest in the pit", which is about survival, so a clear may end the run early — that counts as reached.
function runRound(r) {
  D.setRound(r); D.setGodMode(true);
  dom.el('start').onclick();
  const target = D.state().target;
  for (let frames = 1; frames <= maxFrames; frames++) {
    autopilot(); dom.frame(1);
    const st = D.state();
    if (st.player.len >= target || !st.running) return { frames, reached: true, len: st.player.len, target };
  }
  return { frames: maxFrames, reached: false, len: D.state().player.len, target };
}
const median = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
console.log(`runs=${runs} maxFrames=${maxFrames} pace=${globalThis.NOODLE_PACE || 'default'}`);
console.log('round  target  reached%  median frames to target  median len/1000f');
for (let r = 0; r < 5; r++) {
  const res = []; for (let i = 0; i < runs; i++) res.push(runRound(r));
  const ok = res.filter(x => x.reached), target = res[0].target;
  const rate = median(res.map(x => (x.len - 10) / x.frames * 1000));
  console.log(`${String(r + 1).padEnd(6)} ${String(target).padEnd(7)} ${String(Math.round(100 * ok.length / runs) + '%').padEnd(9)} ${String(ok.length ? median(ok.map(x => x.frames)) : '-').padEnd(24)} ${rate.toFixed(1)}`);
}
