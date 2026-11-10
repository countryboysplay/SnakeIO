import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from './load.mjs';

loadScript('sync.js');
const S = globalThis.Sync;

// a worm moving +x at 2.6 px/tick, its points one tick apart
function worm(head, n) { return { id: 7, x: head, y: 5, ang: 0, len: 40, c: '#ff5d4a', skin: null, persona: 'hunter', pts: Array.from({ length: n }, (_, i) => ({ x: head - i * 2.6, y: 5 })) }; }

test('packWorm/unpackWorm round-trips identity, flags and every STEP-th body point', () => {
  const w = worm(100, 40); w.name = 'Player 2'; w.tauntText = 'nom';
  const u = S.unpackWorm(JSON.parse(JSON.stringify(S.packWorm(w, S.F.boost | S.F.human))));
  assert.equal(u.id, 7); assert.equal(u.persona, 'hunter'); assert.equal(u.name, 'Player 2'); assert.equal(u.taunt, 'nom');
  assert.equal(u.flags & S.F.boost, S.F.boost); assert.equal(u.flags & S.F.human, S.F.human); assert.equal(u.flags & S.F.king, 0);
  assert.equal(u.body.length, Math.ceil(40 / S.STEP));
  u.body.forEach((p, j) => { assert.ok(Math.abs(p.x - w.pts[j * S.STEP].x) <= 0.5); assert.equal(p.y, 5); });
});

test('skins survive the trip; plain worms send no skin', () => {
  const w = worm(0, 8); w.skin = { c: '#5cc8ff', c2: '#1b1330', type: 'bands' };
  assert.deepEqual(S.unpackWorm(S.packWorm(w, 0)).skin, { c: '#5cc8ff', c2: '#1b1330', type: 'bands' });
  assert.equal(S.unpackWorm(S.packWorm(worm(0, 8), 0)).skin, null);
});

test('consecutive snapshots share body points, so only the head moves', () => {
  // snapshot at tick T and T+STEP: the worm moved STEP points; sent points line up with the previous ones shifted by one
  const a = S.unpackWorm(S.packWorm(worm(100, 40), 0)), b = S.unpackWorm(S.packWorm(worm(100 + 2.6 * S.STEP, 40 + S.STEP), 0));
  for (let j = 0; j < a.body.length; j++) assert.ok(Math.abs(b.body[j + 1].x - a.body[j].x) <= 1, `point ${j}`);
});

test('renderPts slides the head from the previous snapshot to the newest and restores tick spacing', () => {
  const body = S.unpackWorm(S.packWorm(worm(100, 41), 0)).body;
  const at0 = S.renderPts(body, 0), at1 = S.renderPts(body, 1), mid = S.renderPts(body, 0.5);
  assert.ok(Math.abs(at0[0].x - body[1].x) < 1e-9, 'a=0: head at the previous head');
  assert.ok(Math.abs(at1[0].x - body[0].x) < 1e-9, 'a=1: head at the newest head');
  assert.ok(mid[0].x > at0[0].x && mid[0].x < at1[0].x);
  // spacing between consecutive points stays about one tick's travel
  for (let i = 1; i < at1.length; i++) assert.ok(Math.abs(at1[i - 1].x - at1[i].x) < 2.6 * 1.6, 'dense spacing at ' + i);
  assert.ok(at1.length >= 37 && at1.length <= 41, 'about as many points as the original body: ' + at1.length);
  assert.deepEqual(S.renderPts([{ x: 1, y: 2 }], 0.3), [{ x: 1, y: 2 }]);
  assert.deepEqual(S.renderPts([], 0.3), []);
  assert.ok(Math.abs(S.renderPts(body, 7)[0].x - body[0].x) < 1e-9, 'a is clamped');
});

test('food packs only what is in view, with palette indices for crumbs and colours for chunks', () => {
  const palette = ['#ff5d4a', '#5cc8ff'], fixed = { berry: '#c9457f', grub: '#f3e6a2', apple: '#ffd23f' };
  const table = { crumb: { v: 1, r: 3 }, berry: { v: 3, r: 4.5 }, grub: { v: 5, r: 5.5 }, apple: { v: 15, r: 7 }, chunk: { v: 2, r: 4 } };
  const list = [
    { x: 10, y: 10, kind: 'crumb', c: '#5cc8ff' }, { x: 20, y: 20, kind: 'chunk', c: '#c9f24a' },
    { x: 30, y: 30, kind: 'apple', c: '#ffd23f' }, { x: 5000, y: 0, kind: 'berry', c: '#c9457f' },
  ];
  const packed = S.packFood(list, palette, S.viewTest(0, 0, 200, 200));
  const out = S.unpackFood(packed, palette, fixed, table);
  assert.equal(out.length, 3, 'off-screen berry dropped');
  assert.equal(out[0].c, '#5cc8ff'); assert.equal(out[1].c, '#c9f24a'); assert.equal(out[2].c, '#ffd23f');
  assert.equal(out[2].v, 15); assert.equal(out[1].kind, 'chunk');
});

test('pickups round-trip with their age', () => {
  const p = S.unpackPickups(S.packPickups([{ x: 1, y: 2, kind: 'magnet', born: 90 }], 100), 500);
  assert.deepEqual(p, [{ x: 1, y: 2, kind: 'magnet', born: 490 }]);
});

test('wormInView catches a worm whose head is off-screen but whose body crosses the view', () => {
  const w = worm(2000, 900), view = S.viewTest(0, 5, 100, 100);
  assert.equal(view(w.x, w.y), false);
  assert.equal(S.wormInView(w, view), true);
  assert.equal(S.wormInView(worm(9000, 10), view), false);
});

test('room codes: 4 letters, no I or O; cleanCode normalises what people type', () => {
  for (let i = 0; i < 200; i++) assert.match(S.makeCode(), /^[A-HJ-NP-Z]{4}$/);
  assert.equal(S.cleanCode(' ab-cd '), 'ABCD');
  assert.equal(S.cleanCode('wxyzq'), 'WXYZ');
  assert.equal(S.lerpAngle(3, -3, 0.5).toFixed(3), (Math.PI).toFixed(3), 'shortest way round');
});
