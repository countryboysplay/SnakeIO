import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadScript } from './load.mjs';
import { installDom } from './dom-stub.mjs';

// A guest phone with a fake Net: joining by code, the lobby, start, rendering from snapshots, sending input,
// the respawn countdown, the end-of-match standings, and the host leaving.
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const dom = installDom({ html: html.slice(html.indexOf('<body>') + 6, html.indexOf('<script')) });
for (const f of ['songs.js', 'audio.js', 'fx.js', 'items.js', 'rules.js', 'sync.js', 'game.js']) loadScript(f);
const D = globalThis.NoodleDebug, S = globalThis.Sync, FX = globalThis.FX;
const ov = () => dom.el('overlay');

const toHost = [];
let handler = null, joined = null, failNext = null;
globalThis.Net = {
  role: null,
  async join(code, meta, h) { if (failNext) { const e = failNext; failNext = null; throw e; } handler = h; joined = { code, meta }; this.role = 'guest'; },
  toHost(msg) { toHost.push(msg); }, send() { return true; }, broadcast() {}, kick() {}, close() { this.role = null; },
};
const flush = () => new Promise(r => setImmediate(r));
// a worm the "host" would send: head at (x,y) heading +x, points one tick (2.6 px) apart
function wormAt(id, x, y, len, extra = {}) { return { id, x, y, ang: 0, len, c: '#ff5d4a', skin: null, persona: 'hunter', pts: Array.from({ length: Math.floor(len * 1.6) }, (_, i) => ({ x: x - i * 2.6, y })), ...extra }; }
function snap(me, worms, extra = {}) {
  return { k: 's', w: worms.map(w => S.packWorm(w, w.flags || 0)), f: [10, 10, 1, 0, 30, 0, 0, 2], p: [50, 50, 3, 10], la: [0.5], fz: [300, 300, 1], ar: 2200, L: 5000,
    me: { i: me.id, d: 0, r: 0, fx: [['shield', 0.5]], s: 1234, st: 0, len: me.len, cx: me.x, cy: me.y }, e: [], b: [[me.id, 'Ann', 1234], [1, 'Hosty', 900]], ...extra };
}

test('joining with a bad code length shows an error without touching the network', () => {
  dom.frame(2);
  dom.el('party').onclick();
  dom.el('pcode').value = 'ab';
  dom.el('join').onclick();
  assert.ok(ov().innerHTML.includes('4 letters'));
  assert.equal(joined, null);
});

test('a failed join comes back to the party menu with the reason', async () => {
  failNext = new Error('No game with that code. Check the letters with the host.');
  dom.el('pcode').value = 'zzzz';
  dom.el('join').onclick(); await flush();
  assert.ok(ov().innerHTML.includes('No game with that code'));
  assert.equal(D.guest(), null);
});

test('joining sends name, skin and screen size, then waits in the lobby', async () => {
  dom.el('pname').value = 'Ann';
  dom.el('pcode').value = ' wx-yz ';
  dom.el('join').onclick(); await flush();
  assert.equal(joined.code, 'WXYZ');
  assert.equal(joined.meta.name, 'Ann'); assert.equal(joined.meta.w, 390); assert.equal(joined.meta.h, 844);
  assert.ok(ov().innerHTML.includes('Joined') && ov().innerHTML.includes('WXYZ'));
  handler({ type: 'data', id: 'host', data: { k: 'lobby', names: ['Hosty', 'Ann'] } });
  assert.ok(ov().innerHTML.includes('Hosty') && ov().innerHTML.includes('Ann'));
});

test('start puts the guest in the pit with the host\'s hazards', () => {
  handler({ type: 'data', id: 'host', data: { k: 'start', id: 7, baseR: 2200, mud: [[100, 100, 150, 1]], logs: [[600, 0, 0.5, 0.008]], hats: { 7: '🧢' } } });
  const st = D.state();
  assert.equal(st.mode, 'party');
  assert.equal(ov().classList.contains('show'), false, 'overlay hidden');
  assert.equal(st.mud.length, 1); assert.equal(st.logs.length, 1);
  assert.equal(dom.el('pause').hidden, true);
});

test('snapshots become worms, food and HUD; the head glides between snapshots', () => {
  const me = wormAt(7, 0, 0, 40, { name: 'Ann', flags: S.F.human }), them = wormAt(9, 200, 100, 60, { flags: S.F.boost });
  handler({ type: 'data', id: 'host', data: snap(me, [me, them]) });
  dom.frame(1);
  let st = D.state();
  assert.equal(st.worms.length, 2);
  assert.equal(st.player.id, 7, 'my worm is the player');
  assert.equal(st.player.hatGlyph, '🧢');
  assert.equal(st.food.length, 2); assert.equal(st.food[0].kind, 'berry');
  assert.equal(st.pickups[0].kind, 'magnet');
  assert.ok(st.frenzy && st.frenzy.live);
  assert.equal(dom.el('score').textContent, 1234); assert.equal(+dom.el('len').textContent, 40);
  assert.ok(dom.el('buffs').innerHTML.includes('🛡'), 'buffs come from the snapshot');
  assert.ok(dom.el('board').innerHTML.includes('Ann') && dom.el('board').innerHTML.includes('class="me"'));
  // next snapshot: everyone moved STEP ticks to the right; right after it arrives the head is still near the old spot
  const me2 = wormAt(7, 2.6 * S.STEP, 0, 40, { name: 'Ann', flags: S.F.human });
  handler({ type: 'data', id: 'host', data: snap(me2, [me2, them]) });
  dom.frame(1);
  st = D.state();
  assert.ok(st.player.x >= 0 && st.player.x < 2.6 * S.STEP + 0.01, 'head interpolates between the snapshots: ' + st.player.x);
  assert.ok(st.player.pts.length > 30, 'body filled back in');
});

test('the guest sends its joystick and boost to the host', () => {
  toHost.length = 0;
  D.steer(1.25);
  dom.fireWindow('keydown', { code: 'Space' });
  dom.frame(7);   // input goes out on change at most 20×/s, with a keep-alive every 6 frames
  dom.fireWindow('keyup', { code: 'Space' });
  const m = toHost.filter(x => x.k === 'in').at(-1);
  assert.ok(m, 'input sent');
  assert.ok(Math.abs(m.a - 1.25) <= 0.011, 'steer quantised to ~1°: ' + m.a); assert.equal(m.b, 1);
  assert.ok(toHost.filter(x => x.k === 'in').length <= 3, 'not a message every frame');
});

test('feedback events from the host play on the guest (banners, texts)', () => {
  const me = wormAt(7, 10, 0, 40, { name: 'Ann', flags: S.F.human });
  handler({ type: 'data', id: 'host', data: snap(me, [me], { e: [['b', 'DOUBLE NOODLE!', '#5cc8ff', 90, '+4 length'], ['t', 0, 0, 'Close!', '#5cc8ff', 16]] }) });
  assert.equal(FX._banner.text, 'DOUBLE NOODLE!');
  assert.ok(FX.texts.some(t => t.str === 'Close!'));
});

test('when the guest is eaten the camera follows the snapshot focus and shows the countdown', () => {
  const them = wormAt(9, 500, 500, 60);
  handler({ type: 'data', id: 'host', data: snap({ id: 7, len: 0, x: 500, y: 500 }, [them], { me: { i: 7, d: 1, r: 2, fx: [], s: 1300, st: 0, len: 0, cx: 500, cy: 500 } }) });
  for (let i = 0; i < 60; i++) dom.frame(1);
  const st = D.state();
  assert.equal(st.player.dead, true);
  assert.ok(Math.hypot(st.player.x - 500, st.player.y - 500) < 1);
});

test('numbers from the host are coerced before they reach the page; late joiners\' hats arrive', () => {
  handler({ type: 'data', id: 'host', data: { k: 'hat', id: 42, g: '👑' } });
  assert.equal(D.guest().hats[42], '👑');
  handler({ type: 'data', id: 'host', data: { k: 's', w: [], f: [], p: [], la: [], fz: 0, ar: 2200, L: 100, me: { i: 7, d: 1, r: 1, fx: [], s: 5, st: 0, len: 0, cx: 0, cy: 0 }, e: [], b: [[7, 'Ann', '<img src=x onerror=alert(1)>']] } });
  assert.ok(!dom.el('board').innerHTML.includes('<img'), 'score is a number, never markup');
});

test('end of match shows the standings; the host leaving returns to the party menu', () => {
  handler({ type: 'data', id: 'host', data: { k: 'end', st: [{ id: 7, name: 'Ann', score: 1300, kills: 2, best: 80, deaths: 1 }, { id: 1, name: '<i>Hosty</i>', score: '<b>9</b>', kills: 1, best: 60, deaths: 2 }] } });
  assert.ok(ov().innerHTML.includes('You win!') && ov().innerHTML.includes('Waiting for the host'));
  assert.ok(!ov().innerHTML.includes('<i>Hosty') && !ov().innerHTML.includes('<b>9'), 'names escaped, numbers coerced');
  handler({ type: 'leave', id: 'host' });
  assert.ok(ov().innerHTML.includes('The host closed the game.') && ov().innerHTML.includes('Host a game'));
  assert.equal(D.guest(), null);
  assert.equal(globalThis.Net.role, null);
});
