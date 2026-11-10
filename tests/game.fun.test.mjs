import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadScript } from './load.mjs';
import { installDom } from './dom-stub.mjs';

// Headless runs of the "more fun" mechanics: hybrid contacts, streaks, near misses, the King fight,
// medals, the daily challenge, hazards, frenzies, the death camera and the style picker.
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const dom = installDom({ html: html.slice(html.indexOf('<body>') + 6, html.indexOf('<script')) });
for (const f of ['songs.js', 'audio.js', 'fx.js', 'items.js', 'rules.js', 'sync.js', 'game.js']) loadScript(f);
const D = globalThis.NoodleDebug, FX = globalThis.FX;
const ov = () => dom.el('overlay');

// player at the origin heading +x with a straight body trailing along -x
function layPlayer(len = 40) {
  const p = D.state().player; p.len = len; p.x = 0; p.y = 0; p.ang = 0; D.steer(0);
  p.pts = Array.from({ length: len }, (_, i) => ({ x: -i * 3, y: 0 }));
  return p;
}
// park a rival with its head at (x,y) heading `ang` and its body trailing straight behind it
function placeRival(w, x, y, ang, len) {
  w.len = len; w.x = x; w.y = y; w.ang = ang; w.boost = 0;
  w.pts = Array.from({ length: Math.floor(len * 1.6) }, (_, i) => ({ x: x - Math.cos(ang) * i * 3, y: y - Math.sin(ang) * i * 3 }));
  return w;
}
// advance exactly one simulation tick (slow-mo can skip frames)
function tick1() { const t = D.state().tick; for (let i = 0; i < 4 && D.state().tick === t; i++) dom.frame(1); }
function ticks(n) { const t = D.state().tick + n; for (let i = 0; i < n * 4 && D.state().tick < t; i++) dom.frame(1); }
const rivals = () => D.state().worms.filter(w => w.ai && !w.dead && !w.isKing);
// the title screen has one button per mode; other screens' #start replays the current mode
function startMode(mode, round = 0) {
  D.setMode(mode); D.setRound(round);
  const id = mode === 'rounds' ? 'start' : mode;
  (ov().innerHTML.includes(`id="${id}"`) ? dom.el(id) : dom.el('start')).onclick();
  dom.frame(1);
}
function quit() { if (D.state().running) { dom.fireWindow('keydown', { code: 'KeyP' }); dom.el('quit').onclick(); } else if (D.state().deathT) dom.frame(D.state().deathT + 1); }

test('endless is locked on the title screen until the King is beaten', () => {
  dom.frame(5);
  assert.ok(ov().innerHTML.includes('beat the Pit King to unlock'));
  dom.el('endless').onclick();
  assert.equal(D.state().running, false, 'locked endless does not start');
  assert.ok(ov().innerHTML.includes('📅 Daily'), 'daily button on the title');
});

test('style picker: tabs switch between skins, hats, trails and pops', () => {
  const box = dom.el('style'), tabs = box.children[0];
  assert.equal(tabs.children.length, 4);
  tabs.children[1].onclick();
  const grid = dom.el('style').children[1];
  assert.ok(grid.children.some(c => c.children.some(g => g.textContent === '🧢')), 'hats grid shows the cap');
  grid.children[0].onclick();   // "none" is free
  assert.equal(D.state().style.hat, 'none');
});

test('side hit: a giant running into the player\'s side dies and the player gets the kill', () => {
  startMode('rounds');
  layPlayer();
  const eaten0 = +(dom.storage.get('noodleEaten') || 0);
  const big = placeRival(rivals()[0], -75, 12, -Math.PI / 2, 200);
  tick1();
  assert.equal(big.dead, true, 'the bigger worm popped');
  assert.equal(D.state().player.dead, false);
  assert.equal(+dom.storage.get('noodleEaten'), eaten0 + 1, 'credited to the player');
  assert.ok(D.state().score > 0, 'kill scores');
});

test('a second kill inside the window is a DOUBLE NOODLE streak with bonus length', () => {
  const len0 = D.state().player.len;
  layPlayer(Math.max(40, len0));
  const lenBefore = D.state().player.len;
  placeRival(rivals()[1], -60, 12, -Math.PI / 2, 150);
  tick1();
  assert.equal(D.state().streak.count(D.state().tick), 2);
  assert.equal(FX._banner.text, 'DOUBLE NOODLE!');
  assert.ok(D.state().player.len > lenBefore, 'streak bonus length');
});

test('near miss: skimming past a body scores a Close! and counts toward unlocks', () => {
  layPlayer(40);
  const n0 = D.state().stats.nearMisses;
  placeRival(rivals()[2], 60, 18, 0, 25);
  tick1();
  assert.equal(D.state().player.dead, false);
  assert.equal(D.state().stats.nearMisses, n0 + 1);
  assert.ok(FX.texts.some(t => t.str === 'Close!'));
});

test('running into a small worm\'s side kills the player; death cam, taunt, rank, then nemesis on retry', () => {
  layPlayer(40);
  const small = placeRival(rivals()[3], 8, -60, -Math.PI / 2, 15);
  small.pts = Array.from({ length: 24 }, (_, i) => ({ x: 8, y: -60 + i * 3 }));
  tick1();
  const st = D.state();
  assert.equal(st.player.dead, true);
  assert.equal(st.running, false);
  assert.ok(st.deathT > 0, 'death camera running');
  assert.equal(ov().classList.contains('show'), false, 'game-over waits for the death cam');
  assert.ok(small.nemesis && small.taunt, 'the killer is marked and taunts');
  dom.frame(st.deathT + 1);
  assert.ok(ov().classList.contains('show') && ov().innerHTML.includes('Eaten') && ov().innerHTML.includes('biggest of'), 'game over with rank');
  assert.ok(ov().innerHTML.includes('Retry round 1'));
  dom.el('start').onclick(); dom.frame(1);
  assert.ok(D.state().worms.some(w => w.nemesis && !w.dead), 'nemesis comes back on retry');
  quit();
});

test('every end screen has a Menu button back to the title', () => {
  startMode('rounds', 0);
  const p = layPlayer(40); p.x = 2190; p.pts = p.pts.map((q, i) => ({ x: 2190 - i * 3, y: 0 }));
  ticks(10); dom.frame(D.state().deathT + 1);
  assert.ok(ov().innerHTML.includes('Retry round') && ov().innerHTML.includes('id="menu"'));
  dom.el('menu').onclick();
  assert.ok(ov().innerHTML.includes('Noodle Pit') && ov().innerHTML.includes('📅 Daily'), 'back on the title');
  assert.equal(D.state().mode, 'rounds');
});

test('clearing a round fast awards gold, a time bonus and stores the medal', () => {
  startMode('rounds', 0);
  const st = D.state();
  for (const w of st.worms) if (w.ai) w.len = 5;
  layPlayer(st.target + 5);
  dom.frame(1);
  assert.ok(ov().innerHTML.includes('Round cleared') && ov().innerHTML.includes('🥇'));
  assert.equal(JSON.parse(dom.storage.get('noodleMedals'))[0], 'gold');
  assert.ok(D.state().score > 0);
});

test('the Pit King: three side-bonks shed his lives, then he dies and the run is won', () => {
  startMode('rounds', 4);
  assert.equal(dom.el('boss').hidden, false, 'boss bar shows');
  const k = D.state().king;
  assert.equal(k.hp, 3);
  // keep roaming rivals (not the King) from ending the run between bonks
  const park = () => { for (const w of D.state().worms) { if (!w.ai || w.isKing) continue; const dx = 1500 - w.x, dy = -w.y; w.x += dx; w.y += dy; for (const p of w.pts) { p.x += dx; p.y += dy; } w.persona = 'coward'; } };
  const banners = [];
  for (let i = 0; i < 3; i++) {
    park(); layPlayer(40);
    placeRival(k, -75, 20, -Math.PI / 2, k.len); k.stun = 0;
    tick1();
    assert.equal(D.state().player.dead, false, 'a bonk never hurts the player');
    assert.equal(k.hp, 2 - i, `bonk ${i}: ` + JSON.stringify({ k: [k.x, k.y, k.ang, k.boost, k.stun, k.len, k.immuneUntil], tick: D.state().tick, ghost: D.state().effects.has('ghost'), p: [D.state().player.x, D.state().player.y, D.state().player.len, D.state().player.pts.length] }));
    banners.push(FX._banner.text);
    if (i < 2) ticks(90); else for (let f = 0; f < 400 && !ov().classList.contains('show'); f++) dom.frame(1);
  }
  assert.deepEqual(banners.slice(0, 2), ['THE KING IS FURIOUS', 'THE KING IS DESPERATE']);
  assert.equal(k.dead, true);
  assert.ok(ov().innerHTML.includes('You rule the pit'), 'win screen after the slow-mo beat');
  assert.equal(D.state().stats.kingBeaten, true);
  assert.equal(dom.el('boss').hidden, true);
});

test('hazards bonk the King instead of killing him: the wall and spike logs each cost a life', () => {
  startMode('rounds', 4);
  const k = D.state().king, park = () => { for (const w of D.state().worms) if (w.ai && !w.isKing) { w.x += 5000; for (const p of w.pts) p.x += 5000; } };
  park();
  placeRival(k, 0, -(D.state().arenaR - 1), -Math.PI / 2, k.len); k.stun = 0;
  tick1();
  assert.equal(k.dead, false, 'the wall does not kill the King');
  assert.equal(k.hp, 2);
  assert.ok(Math.hypot(k.x, k.y) < D.state().arenaR, 'pushed back inside');
  ticks(90);
  const g = D.state().logs[0];
  placeRival(k, g.x - Math.sin(g.a) * 20, g.y + Math.cos(g.a) * 20, g.a - Math.PI / 2, k.len); k.stun = 0;   // already touching (mud could slow his approach)
  tick1();
  assert.equal(k.dead, false, 'a spike log does not kill the King');
  assert.equal(k.hp, 1);
  ticks(90);
  placeRival(k, 0, -(D.state().arenaR - 1), -Math.PI / 2, k.len); k.stun = 0;
  tick1();
  assert.equal(k.hp, 1, 'a hazard can never take his last life');
  assert.equal(k.dead, false);
  quit();
});

test('endless unlocks after the King and runs with bigger respawns over time', () => {
  dom.el('start').onclick(); dom.frame(1); quit();   // play again → back to a title
  assert.ok(ov().innerHTML.includes('♾ Endless') && !ov().innerHTML.includes('beat the Pit King to unlock'));
  dom.el('endless').onclick(); dom.frame(1);
  assert.equal(D.state().mode, 'endless');
  assert.equal(dom.el('roundNum').textContent, '♾');
  quit();
});

test('daily: same seed lays out the same arena; the timer runs out into a Time! screen', () => {
  D.setDaily('2026-11-03', 'giants');
  startMode('daily');
  const a = rivals().map(w => [Math.round(w.x), Math.round(w.y), w.persona]);
  assert.ok(rivals().every(w => w.len >= 90), 'giants modifier: huge rivals');
  assert.equal(dom.el('timer').hidden, false);
  quit();
  startMode('daily');
  const b = rivals().map(w => [Math.round(w.x), Math.round(w.y), w.persona]);
  // one frame of (unseeded) steering has run, so allow a few pixels of drift
  assert.equal(b.length, a.length);
  a.forEach((w, i) => { assert.equal(b[i][2], w[2], 'same personality'); assert.ok(Math.hypot(b[i][0] - w[0], b[i][1] - w[1]) < 8, 'same start position'); });
  D.setGodMode(true);
  dom.frame(60);
  D.skipTime(3 * 60 * 60);
  for (let i = 0; i < 20 && D.state().running; i++) dom.frame(1);
  D.setGodMode(false);
  assert.ok(ov().innerHTML.includes('Time!'), 'time-up screen');
  assert.ok(JSON.parse(dom.storage.get('noodleDaily')).key === '2026-11-03');
});

test('daily ghost town: worms pass through each other', () => {
  D.setDaily('2026-11-04', 'ghosts');
  startMode('daily');
  layPlayer(40);
  const small = placeRival(rivals()[0], 8, -60, -Math.PI / 2, 15);
  small.pts = Array.from({ length: 24 }, (_, i) => ({ x: 8, y: -60 + i * 3 }));
  tick1(); tick1();
  assert.equal(D.state().player.dead, false);
  quit();
});

test('hazards: Apex has spike logs that pop the player, and the wall closes in', () => {
  startMode('rounds', 3);
  const st = D.state();
  assert.ok(st.logs.length >= 1 && st.mud.length >= 1);
  D.setGodMode(true); dom.frame(600); D.setGodMode(false);
  assert.ok(D.state().arenaR < 2200, 'arena shrinking');
  const g = D.state().logs[0], p = layPlayer(40);
  p.x = g.x - Math.sin(g.a) * 14; p.y = g.y + Math.cos(g.a) * 14; p.ang = g.a + Math.PI / 2 + Math.PI; D.steer(p.ang);
  p.pts = p.pts.map((q, i) => ({ x: p.x - Math.cos(p.ang) * i * 3, y: p.y - Math.sin(p.ang) * i * 3 }));
  tick1();
  assert.equal(D.state().player.dead, true);
  dom.frame(D.state().deathT + 1);
  assert.ok(ov().innerHTML.includes('spike log'), 'game over names the log: ' + ov().innerHTML.slice(0, 120));
});

test('feeding frenzy: announced, then rains rich food in its zone', () => {
  startMode('rounds', 0);
  D.setGodMode(true);
  D.startFrenzy(); dom.frame(1);
  const fz = D.state().frenzy;
  assert.ok(fz && !fz.live);
  assert.equal(FX._banner.text, 'FEEDING FRENZY');
  dom.frame(260);
  assert.ok(D.state().frenzy.live && D.state().frenzy.count > 10);
  D.setGodMode(false);
  quit();
});
