import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from './load.mjs';

loadScript('songs.js');
const S = globalThis.Songs;

test('note names and chords parse', () => {
  assert.equal(S.midi('A4'), 69); assert.equal(S.midi('C4'), 60); assert.equal(S.midi('C#5'), 73); assert.equal(S.midi('Bb4'), 70);
  assert.equal(S.freq(69), 440);
  assert.deepEqual(S.chord('Am7'), { root: 9, tones: [0, 3, 7, 10] });
  assert.deepEqual(S.chord('G'), { root: 7, tones: [0, 4, 7] });
  assert.throws(() => S.midi('H2')); assert.throws(() => S.chord('Xsus4'));
});

test('every song lines up: each part fills exactly 16 steps per bar for every chord', () => {
  for (const name of ['menu', 'play', 'king']) {
    const c = S.get(name), bars = S.SONGS[name].chords.length;
    assert.equal(c.total, bars * 16, name);
    assert.equal(c._check.leadSteps, bars * 16, name + ' lead');
    assert.equal(c._check.bassSteps, bars * 16, name + ' bass');
    assert.equal(c._check.padSteps, 16, name + ' pad');
    assert.deepEqual(c._check.drumSteps, [16, 16, 16], name + ' drums');
    assert.ok(c.bpm >= 60 && c.bpm <= 180, name + ' tempo');
  }
});

test('melodies stay in a singable range and every note sits in its song\'s key or chord', () => {
  const keys = { menu: [0, 2, 4, 5, 7, 9, 11], play: [0, 2, 4, 5, 7, 9, 11], king: [0, 2, 4, 5, 7, 8, 9, 11] };   // C major; A minor + G#
  for (const name of ['menu', 'play', 'king']) {
    const c = S.get(name);
    for (const e of c.lead.filter(Boolean)) {
      assert.ok(e.value >= S.midi('G4') && e.value <= S.midi('F6'), `${name} note ${e.value} in range`);
      assert.ok(keys[name].includes(e.value % 12), `${name} note ${e.value} in key`);
    }
  }
});

test('bass follows the chords: every bass note is a tone of its bar\'s chord', () => {
  for (const name of ['menu', 'play', 'king']) {
    const c = S.get(name);
    c.bass.forEach((e, step) => { if (e) assert.ok(c.chordTones(step).map(t => t % 12).includes(e.value % 12), `${name} step ${step}`); });
  }
});

test('held notes never run past the end of the loop', () => {
  for (const name of ['menu', 'play', 'king']) {
    const c = S.get(name);
    for (const part of ['lead', 'bass', 'pad']) c[part].forEach((e, i) => { if (e) assert.ok(i + e.len <= c.total, `${name} ${part} @${i}`); });
  }
});
