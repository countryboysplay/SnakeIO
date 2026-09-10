import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from './load.mjs';

// ---- fake Web Audio -------------------------------------------------------
const made = { ctx: 0, osc: 0, gain: 0, src: 0 };
function param(v = 0) {
  const p = { value: v, last: v };
  for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime']) p[m] = (x) => { p.last = x; return p; };
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
  assert.ok(made.osc > 0, 'drone oscillators should now exist');
  Sound.music('off');
});

test('unlock is idempotent — one AudioContext ever', () => {
  Sound.unlock(); Sound.unlock(); Sound.unlock();
  assert.equal(made.ctx, 1);
  assert.equal(Sound._state().unlocked, true);
});

test('every SFX name plays without throwing and makes at least one node', () => {
  for (const n of ['eat', 'eatWorm', 'death', 'wall', 'roundWin', 'unlock', 'tap']) {
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
  assert.ok(made.osc > afterStart.osc, 'new mode builds its own drone');
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
