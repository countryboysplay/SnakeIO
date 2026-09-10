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
