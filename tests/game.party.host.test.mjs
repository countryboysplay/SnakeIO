import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadScript } from './load.mjs';
import { installDom } from './dom-stub.mjs';

// The host's side of party mode, with a fake Net standing in for WebRTC: lobby, start, guest input, snapshots,
// guests eating and being eaten, respawns, leaving, and the end-of-match standings.
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const dom = installDom({ html: html.slice(html.indexOf('<body>') + 6, html.indexOf('<script')) });
for (const f of ['audio.js', 'fx.js', 'items.js', 'rules.js', 'sync.js', 'game.js']) loadScript(f);
const D = globalThis.NoodleDebug, S = globalThis.Sync;
const ov = () => dom.el('overlay');

const sent = [], broadcasts = [];
let handler = null;
globalThis.Net = {
  role: null,
  async host(h, makeCode) { handler = h; this.role = 'host'; assert.match(makeCode(), /^[A-Z]{4}$/); return 'ABCD'; },
  send(id, msg) { sent.push({ id, msg }); return true; },
  broadcast(msg) { broadcasts.push(msg); },
  toHost() {}, kick() {}, close() { this.role = null; },
};
const tick1 = () => { const t = D.state().tick; for (let i = 0; i < 4 && D.state().tick === t; i++) dom.frame(1); };
const ticks = n => { const t = D.state().tick + n; for (let i = 0; i < n * 4 && D.state().tick < t; i++) dom.frame(1); };
const lastTo = (id, k) => [...sent].reverse().find(s => s.id === id && s.msg.k === k);
const guestWorm = () => D.party().roster.get('g1').worm;
// take the AI rivals out of play for a scene (dead, with a respawn far in the future); revive one when it's needed
function benchRivals() { const st = D.state(); for (const w of st.worms) if (w.ai) { w.dead = true; w.respawnAt = st.tick + 1e6; } }
function reviveRival() { const r = D.state().worms.find(w => w.ai); r.dead = false; r.respawnAt = null; return r; }

test('title has a Party button that opens the party menu', () => {
  dom.frame(2);
  assert.ok(ov().innerHTML.includes('👥 Party'));
  dom.el('party').onclick();
  assert.ok(ov().innerHTML.includes('Host a game') && ov().innerHTML.includes('id="pcode"'));
});

test('hosting opens a room and shows its code; a guest joining shows up in the lobby', async () => {
  dom.el('pname').value = 'Hosty';
  dom.el('host').onclick();
  await new Promise(r => setImmediate(r));
  assert.ok(ov().innerHTML.includes('ABCD'), 'room code shown');
  assert.ok(ov().innerHTML.includes('Hosty'), 'host listed by name');
  handler({ type: 'join', id: 'g1', meta: { name: '<b>Ann</b>', skin: 'coral', hat: 'cap', w: 400, h: 800 } });
  assert.ok(ov().innerHTML.includes('bAnnb') && !ov().innerHTML.includes('<b>Ann'), 'name is cleaned, never injected as HTML');
  assert.ok(ov().innerHTML.includes('Start · 2 players'));
  assert.deepEqual(broadcasts.at(-1), { k: 'lobby', names: ['Hosty', 'bAnnb'] });
});

test('starting sends each guest a start message and puts both humans in the pit', () => {
  dom.el('go').onclick();
  const st = D.state();
  assert.equal(st.mode, 'party'); assert.equal(st.running, true);
  const start = lastTo('g1', 'start');
  assert.ok(start, 'start sent');
  const g = guestWorm();
  assert.equal(start.msg.id, g.id);
  assert.ok(g.human && g.peer === 'g1' && g.name === 'bAnnb' && g.skin.id === 'coral');
  assert.equal(st.worms.filter(w => w.human).length, 2);
  assert.equal(dom.el('pause').hidden, true, 'no pausing a shared pit');
  assert.equal(dom.el('timer').hidden, false); assert.equal(dom.el('board').hidden, false);
});

test('guest input steers its worm and the guest gets a snapshot of its surroundings', () => {
  const g = guestWorm();
  benchRivals();   // so a wandering one can't eat the guest mid-check
  handler({ type: 'data', id: 'g1', data: { k: 'in', a: 1.0, b: 1 } });
  ticks(40);
  assert.ok(Math.abs(Math.atan2(Math.sin(g.ang - 1.0), Math.cos(g.ang - 1.0))) < 0.05, 'turned to the requested heading');
  assert.equal(g.fast, true, 'boosting');
  handler({ type: 'data', id: 'g1', data: { k: 'in', a: null, b: 0 } });
  ticks(S.STEP * 2);
  const snap = lastTo('g1', 's');
  assert.ok(snap, 'snapshot sent');
  const m = snap.msg;
  assert.equal(m.me.i, g.id);
  assert.ok(m.w.some(w => w[0] === g.id), 'its own worm is in it');
  assert.ok(Array.isArray(m.f) && m.f.length % 4 === 0);
  assert.ok(m.L > 0 && m.L <= 3 * 60 * 60);
  assert.ok(JSON.stringify(m).length < 60000, 'snapshot stays small: ' + JSON.stringify(m).length);
});

test('a guest that runs into a rival is eaten, sees the banner, and respawns after 3 s', () => {
  const g = guestWorm(), st = D.state();
  benchRivals(); const r = reviveRival();
  g.x = 0; g.y = 300; g.ang = 0; g.pts = Array.from({ length: 10 }, (_, i) => ({ x: -i * 3, y: 300 }));
  g.fx.clear(); g.input.steer = 0;
  r.len = 15; r.x = 8; r.y = 240; r.ang = -Math.PI / 2; r.pts = Array.from({ length: 24 }, (_, i) => ({ x: 8, y: 240 + i * 5 }));
  g.out.length = 0;
  tick1();
  assert.equal(g.dead, true);
  assert.ok(g.out.some(e => e[0] === 'b' && e[1] === 'EATEN'), 'banner queued for the guest');
  assert.equal(D.state().running, true, 'the match goes on');
  ticks(S.STEP);
  const m = lastTo('g1', 's').msg;
  assert.equal(m.me.d, 1); assert.ok(m.me.r >= 1 && m.me.r <= 3, 'respawn countdown ' + m.me.r);
  ticks(185);
  assert.equal(g.dead, false, 'back in the pit'); assert.ok(g.len < 25, 'starts small again (it may have eaten a pellet): ' + g.len); assert.ok(g.fx.has('ghost'), 'spawn protection');
});

test('the host eating a guest scores a player kill for the host', () => {
  const st = D.state(), g = guestWorm(), p = st.player;
  g.fx.clear(); p.fx.clear();
  p.dead = false; p.respawnAt = null;   // the host may have been eaten while we waited out the guest's respawn
  p.len = 40; p.x = 0; p.y = 0; p.ang = 0; D.steer(0); p.pts = Array.from({ length: 40 }, (_, i) => ({ x: -i * 3, y: 0 }));
  g.len = 20; g.x = -75; g.y = 12; g.ang = -Math.PI / 2; g.input.steer = -Math.PI / 2; g.pts = Array.from({ length: 32 }, (_, i) => ({ x: -75, y: 12 + i * 3 }));
  const before = st.score;
  tick1();
  assert.equal(g.dead, true, 'guest ran into the host\'s side ' + JSON.stringify({ g: [g.x, g.y, g.ang, g.len, g.dead, g.fx.active()], p: [p.x, p.y, p.len, p.dead, p.fx.active()], pd: D.state().player === p }));
  assert.ok(D.state().score > before, 'host scored');
});

test('duplicate names get numbered and the lobby never hangs, however many share one', () => {
  for (let i = 0; i < 6; i++) handler({ type: 'join', id: 'dup' + i, meta: { name: 'Noodle' } });
  const names = [...D.party().roster.values()].map(g => g.name);
  assert.equal(new Set(names).size, names.length, 'all distinct: ' + names.join(', '));
  assert.ok(names.includes('Noodle') && names.includes('Noodle 2'));
  for (let i = 0; i < 6; i++) handler({ type: 'leave', id: 'dup' + i });
});

test('a guest leaving mid-match takes its worm out of the pit', () => {
  handler({ type: 'join', id: 'g2', meta: { name: 'Bo', w: 390, h: 844 } });
  assert.ok(lastTo('g2', 'start'), 'a late joiner gets a start message');
  const bo = D.party().roster.get('g2').worm;
  assert.ok(D.state().worms.includes(bo));
  handler({ type: 'leave', id: 'g2' });
  assert.equal(D.state().worms.includes(bo), false);
  assert.equal(D.party().roster.has('g2'), false);
});

test('at full time the host broadcasts standings and shows them with a Play again', () => {
  D.skipTime(3 * 60 * 60);
  for (let i = 0; i < 10 && D.state().running; i++) dom.frame(1);
  assert.equal(D.state().running, false);
  const end = broadcasts.find(b => b.k === 'end');
  assert.ok(end && end.st.length === 2, 'standings for both humans');
  assert.ok(end.st[0].score >= end.st[1].score, 'sorted by score');
  assert.ok(ov().innerHTML.includes('class="standings"') && ov().innerHTML.includes('Play again'));
  dom.el('go').onclick();
  assert.equal(D.state().running, true, 'play again restarts with the same guests');
  assert.ok(D.party().roster.get('g1').worm && !D.party().roster.get('g1').worm.dead);
});

test('closing the room returns to the title and closes the network', () => {
  dom.fireWindow('keydown', { code: 'KeyP' });
  assert.equal(D.state().paused, false, 'P does nothing in a party');
  D.skipTime(3 * 60 * 60); for (let i = 0; i < 10 && D.state().running; i++) dom.frame(1);
  dom.el('menu').onclick();
  assert.equal(globalThis.Net.role, null);
  assert.equal(D.party(), null);
  assert.equal(D.state().mode, 'rounds');
  assert.ok(ov().innerHTML.includes('Noodle Pit'));
});
