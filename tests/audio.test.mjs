import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from './load.mjs';

// ---- fake Web Audio -------------------------------------------------------
const made = { ctx: 0, osc: 0, gain: 0, src: 0 };
function param(v = 0) {
  const p = { value: v, last: v };
  for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime']) p[m] = (x) => { p.last = x; return p; };
  p.cancelScheduledValues = () => p;
  return p;
}
function node(extra = {}) {
  // connect() targets may be nodes or AudioParams (LFO → filter.frequency); only nodes track inputs.
  return { inputs: [], connect(t) { if (t.inputs) t.inputs.push(this); return t; }, disconnect() {}, start() {}, stop() {}, ...extra };
}
class FakeAudioContext {
  constructor() { made.ctx++; this.currentTime = 0; this.sampleRate = 44100; this.state = 'running'; this.destination = node(); }
  resume() { this.state = 'running'; return Promise.resolve(); }
  createGain() { made.gain++; return node({ gain: param(1) }); }
  createOscillator() { made.osc++; return node({ type: 'sine', frequency: param(440), detune: param(0) }); }
  createBiquadFilter() { return node({ type: 'lowpass', frequency: param(350), Q: param(1) }); }
  createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
  createBufferSource() { made.src++; return node({ buffer: null, loop: false }); }
}
globalThis.AudioContext = FakeAudioContext;
loadScript('songs.js');
loadScript('audio.js');
const Sound = globalThis.Sound;
const snap = () => ({ ...made });

beforeEach(() => { Sound.music('off'); Sound.boost(false); Sound.setMuted(false); });

test('play/boost/music before unlock are safe no-ops', () => {
  // Sound is not unlocked yet at this point in the file
  assert.equal(Sound._state().unlocked, false);
  assert.doesNotThrow(() => { Sound.play('eat'); Sound.play('eatWorm', 40); Sound.boost(true); Sound.boost(false); });
  assert.equal(made.osc, 0);
});

test('a music mode requested before unlock starts when unlocked', () => {
  Sound.music('menu');
  assert.equal(Sound._state().mode, 'menu');
  assert.equal(made.osc, 0, 'nothing should be created without a context');
  assert.equal(Sound.unlock(), true);
  assert.ok(made.osc > 0, 'the first notes of the song are scheduled');
  assert.equal(Sound._state().music.song, 'Noodle Lounge');
  Sound.music('off');
});

test('unlock is idempotent — one AudioContext ever', () => {
  Sound.unlock(); Sound.unlock(); Sound.unlock();
  assert.equal(made.ctx, 1);
  assert.equal(Sound._state().unlocked, true);
});

test('every SFX name plays without throwing and makes at least one node', () => {
  for (const n of ['eat', 'eatWorm', 'death', 'wall', 'roundWin', 'unlock', 'tap', 'apple', 'pickup', 'shieldHit', 'buffEnd']) {
    const before = snap();
    Sound.play(n, 30);
    assert.ok(made.osc + made.src > before.osc + before.src, `${n} should create a source node`);
  }
});

test('setMuted ramps the master gain to 0 and silences SFX', () => {
  Sound.setMuted(true);
  assert.equal(Sound.muted, true);
  const master = Sound._state().ctx.destination.inputs[0];
  assert.equal(master.gain.last, 0);
  const before = snap();
  Sound.play('eat');
  assert.equal(made.osc, before.osc, 'muted play should not schedule nodes');
  Sound.setMuted(false);
  assert.equal(master.gain.last, 1);
});

test('boost(true) twice creates one hum; boost(false) tears it down', () => {
  const before = snap();
  Sound.boost(true); Sound.boost(true);
  assert.equal(made.osc - before.osc, 2, 'one tone oscillator + one LFO');
  assert.equal(Sound._state().boosting, true);
  Sound.boost(false); Sound.boost(false);
  assert.equal(Sound._state().boosting, false);
});

test('music(): same mode is a no-op, switching modes crossfades, off stops', () => {
  Sound.music('play');
  const afterStart = snap();
  Sound.music('play');
  assert.deepEqual(snap(), afterStart, 'repeat mode must not rebuild the graph');
  Sound.music('king');
  assert.ok(made.osc > afterStart.osc, 'the new song schedules its first notes');
  assert.equal(Sound._state().music.song, 'Pit King');
  assert.equal(Sound._state().mode, 'king');
  Sound.music('off');
  assert.equal(Sound._state().mode, 'off');
});

test('eat SFX is throttled to 8 within 100 ms', () => {
  Sound._state().ctx.currentTime = 10; // move past any earlier eat timestamps (the fake clock never advances on its own)
  const before = snap();
  for (let i = 0; i < 20; i++) Sound.play('eat');
  assert.equal(made.osc - before.osc, 8);
});

test('the sequencer schedules steps ahead on the audio clock; a stall skips ahead instead of bursting', async () => {
  const ctx = Sound._state().ctx, wait = ms => new Promise(r => setTimeout(r, ms));
  Sound.music('play');
  assert.equal(Sound._state().music.song, 'Wiggle Run');
  const s0 = Sound._state().music.step;
  // play a second of audio in small slices, as a real clock would: ~8 sixteenths at 124 bpm
  for (let i = 0; i < 20; i++) { ctx.currentTime += 0.05; await wait(30); }
  const s1 = Sound._state().music.step;
  assert.ok(s1 - s0 >= 7 && s1 - s0 <= 11, `advanced ${s1 - s0} steps in 1 s`);
  // a 5 s stall (throttled timer): the next pump schedules only what's due now, not 40 missed steps at once
  const before = made.osc + made.src;
  ctx.currentTime += 5; await wait(40);
  assert.ok(made.osc + made.src - before < 40, 'no burst of missed notes');
  Sound.music('off');
});

test('the music switch stops and restarts the song without touching the mode', () => {
  Sound.music('menu');
  assert.ok(Sound._state().music);
  Sound.setMusicOn(false);
  assert.equal(Sound.musicOn, false); assert.equal(Sound._state().music, null);
  assert.equal(Sound._state().mode, 'menu', 'the game still knows which song belongs here');
  Sound.music('play');
  assert.equal(Sound._state().music, null, 'switching screens with music off stays silent');
  Sound.setMusicOn(true);
  assert.equal(Sound._state().music.song, 'Wiggle Run', 'turning it back on plays the current screen\'s song');
  Sound.music('off');
});

test('intensity marks the frenzy groove on and off', () => {
  Sound.intensity(1); assert.equal(Sound._state().hot, true);
  Sound.intensity(0); assert.equal(Sound._state().hot, false);
});
