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
