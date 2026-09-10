// Noodle Pit audio — every sound is synthesized with Web Audio. No files, no game knowledge.
// Exposes window.Sound. Safe to call anything before unlock(); it just does nothing until then.
(() => {
  const G = typeof window !== 'undefined' ? window : globalThis;
  const AC = G.AudioContext || G.webkitAudioContext;
  const MUSIC_LEVEL = 0.13, SFX_LEVEL = 0.8;   // music ≈ -18 dB under sfx
  let ac = null, master = null, sfxBus = null, musicBus = null;
  let muted = false, boostNodes = null, music = null, mode = 'off', pendingMode = null;
  const recentEats = [];
  let noiseBuf = null;

  const now = () => ac.currentTime;
  const canPlay = () => !!ac && !muted;

  // attack → peak → exponential decay envelope on a GainNode
  function env(g, t0, a, peak, d) {
    g.gain.cancelScheduledValues(t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }
  // one-shot oscillator voice
  function osc(type, f, t0, dur, bus, peak = 0.5, o = {}) {
    const a = o.a ?? 0.005;
    const v = ac.createOscillator(), g = ac.createGain();
    v.type = type; v.frequency.setValueAtTime(f, t0);
    if (o.to) v.frequency.exponentialRampToValueAtTime(o.to, t0 + dur);
    env(g, t0, a, peak, Math.max(0.01, dur - a));
    v.connect(g).connect(bus); v.start(t0); v.stop(t0 + dur + 0.05);
    return v;
  }
  function noiseBuffer() {
    if (!noiseBuf) {
      noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  }
  // one-shot filtered noise voice
  function noise(t0, dur, bus, peak = 0.4, type = 'lowpass', freq = 800) {
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuffer(); s.loop = true; f.type = type; f.frequency.value = freq;
    env(g, t0, 0.003, peak, Math.max(0.01, dur - 0.003));
    s.connect(f).connect(g).connect(bus); s.start(t0); s.stop(t0 + dur + 0.05);
    return s;
  }

  const SFX = {
    eat(v = 1) {
      const t = now();
      recentEats.push(t); while (recentEats.length && recentEats[0] < t - 0.1) recentEats.shift();
      if (recentEats.length > 8) return;
      const q = Math.min(v, 6);   // pitch by tier, but a 15-point apple shouldn't squeal
      osc('sine', 520 + q * 90 + Math.random() * 40, t, 0.09, sfxBus, 0.25, { to: 880 + q * 90 });
    },
    apple() { const t = now(); [1047, 1319, 1568].forEach((f, i) => osc('triangle', f, t + i * 0.06, 0.12, sfxBus, 0.25)); },
    pickup() { const t = now(); osc('sine', 660, t, 0.18, sfxBus, 0.3, { to: 990 }); osc('sine', 880, t + 0.04, 0.18, sfxBus, 0.25, { to: 1320 }); },
    shieldHit() { const t = now(); noise(t, 0.15, sfxBus, 0.5, 'lowpass', 400); osc('sine', 1320, t + 0.02, 0.4, sfxBus, 0.25); },
    buffEnd() { osc('sine', 660, now(), 0.2, sfxBus, 0.15, { to: 330 }); },
    eatWorm(len = 20) {
      const t = now(), k = Math.min(1, len / 150);
      osc('sawtooth', 160 - 60 * k, t, 0.12, sfxBus, 0.35 + 0.25 * k, { to: 90 });
      noise(t, 0.1, sfxBus, 0.25, 'lowpass', 600);
      osc('sine', 300, t + 0.1, 0.22, sfxBus, 0.3, { to: 720 });
    },
    death(off = 0) {
      const t = now() + off;
      osc('square', 320, t, 0.4, sfxBus, 0.3, { to: 60 });
      osc('sine', 200, t, 0.45, sfxBus, 0.3, { to: 40 });
      noise(t, 0.25, sfxBus, 0.5, 'lowpass', 300);
    },
    wall() { osc('square', 1400, now(), 0.06, sfxBus, 0.25, { to: 2400 }); SFX.death(0.06); },
    roundWin() { const t = now(); [523, 659, 784, 1047].forEach((f, i) => osc('triangle', f, t + i * 0.11, 0.3, sfxBus, 0.3)); },
    unlock() { const t = now(); [1, 2, 3].forEach(h => osc('sine', 880 * h, t, 0.6 / h, sfxBus, 0.25 / h)); },
    tap() { noise(now(), 0.02, sfxBus, 0.3, 'highpass', 2000); },
  };

  function boost(on) {
    if (!ac) return;
    if (on && !boostNodes) {
      const o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain(), lfo = ac.createOscillator(), lg = ac.createGain();
      o.type = 'sawtooth'; o.frequency.value = 110;
      f.type = 'lowpass'; f.frequency.value = 500; f.Q.value = 6;
      lfo.frequency.value = 5; lg.gain.value = 250; lfo.connect(lg).connect(f.frequency);
      const t = now(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.18, t + 0.08);
      o.connect(f).connect(g).connect(sfxBus); o.start(); lfo.start();
      boostNodes = { o, lfo, g };
    } else if (!on && boostNodes) {
      const { o, lfo, g } = boostNodes; boostNodes = null;
      const t = now();
      g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0.0001, t + 0.08);
      o.stop(t + 0.1); lfo.stop(t + 0.1);
    }
  }

  // ---- music: generative pad per mode ---------------------------------------
  const MODES = {
    menu: { root: 110,  filter: 600,  pluck: [3, 6], scale: [0, 2, 4, 7, 9],  bpm: 0,  wind: 0 },
    play: { root: 110,  filter: 1200, pluck: [2, 4], scale: [0, 2, 4, 7, 9],  bpm: 70, wind: 0 },
    king: { root: 73.4, filter: 900,  pluck: [2, 4], scale: [0, 2, 3, 7, 8],  bpm: 90, wind: 0.12 },
  };
  function startMusic(m) {
    const p = MODES[m], t = now();
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(1, t + 1); g.connect(musicBus);
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = p.filter; f.Q.value = 1.5; f.connect(g);
    const lfo = ac.createOscillator(), lg = ac.createGain(); lfo.frequency.value = 0.08; lg.gain.value = p.filter * 0.4; lfo.connect(lg).connect(f.frequency); lfo.start();
    const drones = [0, 4].map(det => { const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.value = p.root; o.detune.value = det; o.connect(f); o.start(); return o; });
    const nodes = [...drones, lfo], timers = [];
    const alive = () => music && music.m === m;
    // while the context is suspended (backgrounded tab) keep the clock running but schedule nothing,
    // otherwise every skipped note would pile up at t=0 and fire together on resume
    const live = () => ac.state === 'running';
    const pluck = () => {
      if (!alive()) return;
      if (live()) { const deg = p.scale[Math.random() * p.scale.length | 0]; osc('triangle', p.root * 2 * Math.pow(2, deg / 12) * (Math.random() < 0.3 ? 2 : 1), now(), 0.8, g, 0.35, { a: 0.01 }); }
      timers.push(setTimeout(pluck, (p.pluck[0] + Math.random() * (p.pluck[1] - p.pluck[0])) * 1000));
    };
    timers.push(setTimeout(pluck, 800));
    if (p.bpm) {
      const beat = () => { if (!alive()) return; if (live()) osc('sine', p.root / 2, now(), 0.18, g, 0.5); timers.push(setTimeout(beat, 60000 / p.bpm)); };
      timers.push(setTimeout(beat, 200));
    }
    if (p.wind) {
      const s = ac.createBufferSource(), bf = ac.createBiquadFilter(), wg = ac.createGain();
      s.buffer = noiseBuffer(); s.loop = true; bf.type = 'bandpass'; bf.frequency.value = 400; bf.Q.value = 0.7; wg.gain.value = p.wind;
      s.connect(bf).connect(wg).connect(g); s.start(); nodes.push(s);
    }
    return { m, g, nodes, timers };
  }
  function stopMusic(mu, fade) {
    const t = now();
    mu.g.gain.cancelScheduledValues(t); mu.g.gain.setValueAtTime(mu.g.gain.value, t); mu.g.gain.linearRampToValueAtTime(0.0001, t + fade);
    mu.nodes.forEach(n => n.stop(t + fade + 0.1));
    mu.timers.forEach(clearTimeout);
  }
  function setMusic(m) {
    if (m === mode) return;
    mode = m;
    if (!ac) { pendingMode = m; return; }
    const old = music;
    music = m === 'off' ? null : startMusic(m);
    if (old) stopMusic(old, m === 'off' ? 0.6 : 1);
  }

  function unlock() {
    if (!AC) return false;
    if (!ac) {
      ac = new AC();
      master = ac.createGain(); master.gain.value = muted ? 0 : 1; master.connect(ac.destination);
      sfxBus = ac.createGain(); sfxBus.gain.value = SFX_LEVEL; sfxBus.connect(master);
      musicBus = ac.createGain(); musicBus.gain.value = MUSIC_LEVEL; musicBus.connect(master);
      if (pendingMode && pendingMode !== 'off') { const m = pendingMode; pendingMode = null; mode = 'off'; setMusic(m); }
    }
    wake();
    return true;
  }
  // resume an existing context (covers Safari's 'interrupted' state too) — never constructs one, so it's safe without a gesture
  function wake() { if (ac && ac.state !== 'running') { const p = ac.resume(); if (p && p.catch) p.catch(() => {}); } }
  function setMuted(b) {
    muted = !!b;
    if (!master) return;
    const t = now();
    master.gain.cancelScheduledValues(t); master.gain.setValueAtTime(master.gain.value, t); master.gain.linearRampToValueAtTime(muted ? 0 : 1, t + 0.03);
  }

  G.Sound = {
    unlock, wake, boost, setMuted,
    play(name, arg) { if (canPlay() && SFX[name]) SFX[name](arg); },
    music: setMusic,
    get muted() { return muted; },
    _state() { return { unlocked: !!ac, mode, boosting: !!boostNodes, ctx: ac }; },
  };
})();
