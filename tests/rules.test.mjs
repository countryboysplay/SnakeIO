import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from './load.mjs';

loadScript('rules.js');
const R = globalThis.Rules;

test('hybrid contact: side hits kill the biter whatever the sizes', () => {
  assert.equal(R.resolveContact(500, 10, false), 'biter', 'a giant running into a tiny worm\'s side dies');
  assert.equal(R.resolveContact(10, 500, false), 'biter');
});

test('hybrid contact: head-on clashes go to the bigger worm, ties to the biter', () => {
  assert.equal(R.resolveContact(50, 20, true), 'body');
  assert.equal(R.resolveContact(20, 50, true), 'biter');
  assert.equal(R.resolveContact(30, 30, true), 'body');
});

test('the King plows through rivals and only gets bonked by the player\'s side', () => {
  assert.equal(R.resolveContact(480, 600, false, { biterKing: true }), 'body', 'rivals lose to the King anywhere');
  assert.equal(R.resolveContact(480, 600, true, { biterKing: true }), 'body');
  assert.equal(R.resolveContact(480, 50, false, { biterKing: true, bodyPlayer: true }), 'bonk');
  assert.equal(R.resolveContact(480, 50, true, { biterKing: true, bodyPlayer: true }), 'body', 'head-on he still eats you');
  assert.equal(R.resolveContact(480, 600, true, { biterKing: true, bodyPlayer: true }), 'biter', 'unless you are bigger');
});

test('isHeadOn uses the body worm\'s radius', () => {
  assert.equal(R.isHeadOn(10, 0, 10), true);
  assert.equal(R.isHeadOn(30, 0, 10), false);
});

test('streaks stack inside the window and reset after it; best is kept', () => {
  const s = R.createStreak(100);
  assert.equal(s.hit(0), 1);
  assert.equal(s.hit(50), 2);
  assert.equal(s.hit(140), 3);
  assert.equal(s.count(200), 3);
  assert.equal(s.count(241), 0);
  assert.equal(s.hit(400), 1);
  assert.equal(s.best, 3);
  s.reset(); assert.equal(s.best, 0); assert.equal(s.count(400), 0);
});

test('streak names and bonuses', () => {
  assert.equal(R.streakName(1), '');
  assert.equal(R.streakName(2), 'DOUBLE NOODLE!');
  assert.equal(R.streakName(3), 'TRIPLE NOODLE!');
  assert.equal(R.streakName(99), 'UNSTOPPA-NOODLE!');
  assert.equal(R.streakBonus(1), 0);
  assert.ok(R.streakBonus(3) > R.streakBonus(2));
});

test('scoring: kills scale with victim size and streak; time bonus floors at 0', () => {
  assert.ok(R.killPoints(100, 1) > R.killPoints(10, 1));
  assert.ok(R.killPoints(10, 3) > R.killPoints(10, 1));
  assert.equal(R.timeBonus(10000, 1000), 0);
  assert.equal(R.timeBonus(1000, 1000), Math.round(1000 / 6));
});

test('medals: gold at par, silver up to 1.6× par, bronze after; betterMedal keeps the best', () => {
  assert.equal(R.medalFor(900, 1000), 'gold');
  assert.equal(R.medalFor(1500, 1000), 'silver');
  assert.equal(R.medalFor(5000, 1000), 'bronze');
  assert.equal(R.betterMedal('silver', 'bronze'), 'silver');
  assert.equal(R.betterMedal(null, 'bronze'), 'bronze');
  assert.equal(R.betterMedal('silver', 'gold'), 'gold');
});

test('pickPersona follows the per-round mix and clamps the round index', () => {
  assert.equal(R.pickPersona(0, () => 0), 'grazer');
  assert.equal(R.pickPersona(0, () => 0.999), 'hunter');
  const seen = new Set(); const rnd = R.mulberry32(7);
  for (let i = 0; i < 500; i++) seen.add(R.pickPersona(99, rnd));
  assert.deepEqual([...seen].sort(), ['coiler', 'grazer', 'hunter', 'thief']);
  for (const k of seen) assert.ok(R.PERSONAS[k]);
});

test('arena shrink is linear then holds; no shrink keeps the base radius', () => {
  assert.equal(R.arenaRadius(2000, 0.5, 0), 2000);
  assert.equal(R.arenaRadius(2000, 0.5, R.SHRINK_FRAMES / 2), 1500);
  assert.equal(R.arenaRadius(2000, 0.5, R.SHRINK_FRAMES * 3), 1000);
  assert.equal(R.arenaRadius(2000, 1, 99999), 2000);
});

test('segDist2 measures distance to a rotated segment, clamped at its ends', () => {
  assert.equal(R.segDist2(0, 5, 0, 0, 0, 10), 25);       // above the middle of a horizontal segment
  assert.equal(R.segDist2(13, 4, 0, 0, 0, 10), 25);      // past the end: distance to the end point
  assert.ok(Math.abs(R.segDist2(5, 0, 0, 0, Math.PI / 2, 10) - 25) < 1e-9);
});

test('daily: stable per date, differs across dates, seeded RNG is deterministic', () => {
  const a = R.dailyFor('2026-11-03'), b = R.dailyFor('2026-11-03');
  assert.deepEqual(a, b);
  assert.ok(R.DAILY_MODS.includes(a.mod));
  const mods = new Set(); for (let d = 1; d <= 28; d++) mods.add(R.dailyFor('2026-02-' + String(d).padStart(2, '0')).mod.id);
  assert.ok(mods.size >= 3, 'modifiers rotate across days');
  const r1 = R.mulberry32(42), r2 = R.mulberry32(42);
  for (let i = 0; i < 5; i++) { const x = r1(); assert.equal(x, r2()); assert.ok(x >= 0 && x < 1); }
  assert.equal(R.dateKey(new Date(2026, 0, 5)), '2026-01-05');
});

test('cosmetics: every list has a free first item and unlocks read the stats object', () => {
  const zero = { best: 0, eaten: 0, bestStreak: 0, nearMisses: 0, medals: 0, golds: 0, kingBeaten: false, dailies: 0, endlessBest: 0, deaths: 0 };
  for (const [kind, list] of Object.entries(R.COSMETICS)) {
    assert.equal(list[0].need(zero), true, kind + ' starts with a free item');
    assert.ok(list.slice(1).every(c => !c.need(zero)), kind + ' extras start locked');
    assert.equal(new Set(list.map(c => c.id)).size, list.length, kind + ' ids are unique');
  }
  const crown = R.COSMETICS.hat.find(h => h.id === 'crown');
  assert.equal(crown.need({ ...zero, kingBeaten: true }), true);
});
