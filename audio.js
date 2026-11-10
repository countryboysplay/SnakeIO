// Noodle Pit audio — every sound is synthesized with Web Audio. No files, no game knowledge.
// Exposes window.Sound. Safe to call anything before unlock(); it just does nothing until then.
(() => {
  const G = typeof window !== 'undefined' ? window : globalThis;
  const AC = G.AudioContext || G.webkitAudioContext;
  const MUSIC_LEVEL = 0.11, SFX_LEVEL = 0.8;   // music sits well under the sound effects
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
    // a rising arpeggio that climbs higher with every kill in the streak
    streak(n = 2) { const t = now(), base = 440 * Math.pow(2, Math.min(n - 2, 4) / 6); [0, 4, 7, 12].forEach((s, i) => osc('square', base * Math.pow(2, s / 12), t + i * 0.05, 0.14, sfxBus, 0.16)); },
    nearMiss() { const t = now(); noise(t, 0.12, sfxBus, 0.35, 'highpass', 3000); osc('sine', 1800, t, 0.1, sfxBus, 0.12, { to: 900 }); },
    frenzy() { const t = now(); [784, 988, 1175, 1568, 1976].forEach((f, i) => osc('triangle', f, t + i * 0.07, 0.25, sfxBus, 0.2)); },
    bonk() { const t = now(); osc('sine', 120, t, 0.35, sfxBus, 0.6, { to: 45 }); noise(t, 0.08, sfxBus, 0.4, 'bandpass', 900); osc('square', 660, t + 0.02, 0.3, sfxBus, 0.12, { to: 610 }); },
    revenge() { const t = now(); [196, 247, 294, 392].forEach(f => osc('sawtooth', f, t, 0.5, sfxBus, 0.12)); osc('triangle', 784, t + 0.18, 0.4, sfxBus, 0.25); },
    tick() { osc('square', 1200, now(), 0.04, sfxBus, 0.15); },
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

  // ---- music: a step sequencer playing the songs in songs.js -----------------
  // A timer wakes every 25 ms and schedules the notes due in the next 150 ms on the audio clock, so timing stays
  // tight even when the main thread is busy. Instruments are tiny synth voices built per note.
  const LOOKAHEAD = 0.15, TICK_MS = 25;
  let musicOn = true, hot = false;   // hot: frenzy — a touch faster, with an arpeggio and busier hats
  const noiseBufs = new WeakMap();
  function noiseFor(ctx) {
    if (ctx === ac) return noiseBuffer();
    if (!noiseBufs.has(ctx)) { const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; noiseBufs.set(ctx, b); }
    return noiseBufs.get(ctx);
  }
  const hz = n => 440 * Math.pow(2, (n - 69) / 12);
  // shape: quick attack to peak, settle to sustain, release at the end of the note
  function adsr(g, t, peak, dur, sustain = 0.6, rel = 0.05) {
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + 0.012);
    g.gain.setTargetAtTime(peak * sustain, t + 0.02, 0.08); g.gain.setTargetAtTime(0.0001, t + Math.max(0.03, dur * 0.92), rel);
  }
  const V = {
    lead(ctx, out, t, n, dur, v) {
      const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      o.type = v.lead; o.frequency.setValueAtTime(hz(n), t); f.type = 'lowpass'; f.frequency.value = v.leadCut;
      if (dur > 0.3) {   // a little vibrato on held notes
        const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 5.5;
        lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(hz(n) * 0.007, t + 0.3);
        l.connect(lg).connect(o.frequency); l.start(t); l.stop(t + dur + 0.3);
      }
      adsr(g, t, v.leadGain, dur); o.connect(f).connect(g).connect(out); o.start(t); o.stop(t + dur + 0.3);
    },
    bass(ctx, out, t, n, dur, v) {
      const o = ctx.createOscillator(), sub = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      o.type = 'sawtooth'; sub.type = 'sine'; o.frequency.value = hz(n); sub.frequency.value = hz(n);
      f.type = 'lowpass'; f.Q.value = 4; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(240, t + Math.min(dur, 0.25));
      adsr(g, t, v.bassGain, dur, 0.7, 0.03); o.connect(f); sub.connect(f); f.connect(g).connect(out);
      o.start(t); sub.start(t); o.stop(t + dur + 0.2); sub.stop(t + dur + 0.2);
    },
    pad(ctx, out, t, n, dur, v) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v.padGain, t + Math.min(0.25, dur * 0.4)); g.gain.setTargetAtTime(0.0001, t + dur * 0.9, 0.12);
      g.connect(out);
      for (const det of [-7, 7]) { const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = hz(n); o.detune.value = det; o.connect(g); o.start(t); o.stop(t + dur + 0.6); }
    },
    arp(ctx, out, t, n, dur) {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'square'; o.frequency.value = hz(n);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.045, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.9);
      o.connect(g).connect(out); o.start(t); o.stop(t + dur);
    },
    kick(ctx, out, t, lvl) {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine';
      o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.9 * lvl, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      o.connect(g).connect(out); o.start(t); o.stop(t + 0.3);
    },
    snare(ctx, out, t, lvl) {
      const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = noiseFor(ctx); f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.8;
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.42 * lvl, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      s.connect(f).connect(g).connect(out); s.start(t); s.stop(t + 0.18);
      const o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'triangle'; o.frequency.setValueAtTime(210, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
      og.gain.setValueAtTime(0.0001, t); og.gain.linearRampToValueAtTime(0.25 * lvl, t + 0.003); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      o.connect(og).connect(out); o.start(t); o.stop(t + 0.12);
    },
    hat(ctx, out, t, lvl) {
      const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = noiseFor(ctx); f.type = 'highpass'; f.frequency.value = 7500;
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.16 * lvl, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
      s.connect(f).connect(g).connect(out); s.start(t); s.stop(t + 0.05);
    },
  };
  const stepDur = (song, isHot) => 60 / song.bpm / 4 / (isHot ? 1.06 : 1);
  // play everything due on one 16th-note step
  function playStep(ctx, out, song, step, t, d, isHot) {
    const v = song.voice; let e;
    if ((e = song.lead[step])) V.lead(ctx, out, t, e.value, e.len * d, v);
    if ((e = song.bass[step])) V.bass(ctx, out, t, e.value, e.len * d, v);
    if ((e = song.pad[step])) for (const n of e.value) V.pad(ctx, out, t, n, e.len * d, v);
    if (song.kick(step)) V.kick(ctx, out, t, v.drums);
    if (song.snare(step)) V.snare(ctx, out, t, v.drums);
    if (song.hat(step) || (isHot && step % 2 === 1)) V.hat(ctx, out, t, v.drums);
    if (isHot) { const tones = song.chordTones(step); V.arp(ctx, out, t, 72 + tones[step % tones.length] + (step % 8 >= 4 ? 12 : 0), d); }
  }
  function startMusic(m) {
    const song = G.Songs && G.Songs.get(m); if (!song) return null;
    const t = now(), g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(1, t + 0.6); g.connect(musicBus);
    const mu = { m, g, song, step: 0, next: t + 0.06, alive: true, timer: null };
    mu.timer = setInterval(() => pump(mu), TICK_MS);
    pump(mu);
    return mu;
  }
  function pump(mu) {
    if (!mu.alive) return;
    // while the context is suspended (backgrounded tab) keep the clock but schedule nothing, otherwise every
    // missed note would pile up and fire together on resume
    if (ac.state !== 'running') { mu.next = now() + 0.06; return; }
    const t = now();
    if (mu.next < t - 0.1) mu.next = t + 0.02;   // the timer was throttled: skip ahead rather than burst
    while (mu.next < t + LOOKAHEAD) {
      const d = stepDur(mu.song, hot);
      playStep(ac, mu.g, mu.song, mu.step, mu.next + (mu.step % 2 ? mu.song.swing * d : 0), d, hot);
      mu.next += d; mu.step = (mu.step + 1) % mu.song.total;
    }
  }
  function stopMusic(mu, fade) {
    mu.alive = false; clearInterval(mu.timer);
    const t = now();
    mu.g.gain.cancelScheduledValues(t); mu.g.gain.setValueAtTime(mu.g.gain.value, t); mu.g.gain.linearRampToValueAtTime(0.0001, t + fade);
    setTimeout(() => { try { mu.g.disconnect(); } catch (e) {} }, (fade + 0.4) * 1000);
  }
  function setMusic(m) {
    if (m === mode) return;
    mode = m;
    if (!ac) { pendingMode = m; return; }
    const old = music;
    music = m === 'off' || !musicOn ? null : startMusic(m);
    if (old) stopMusic(old, m === 'off' ? 0.6 : 0.8);
  }
  // the music switch, separate from the master mute
  function setMusicOn(b) {
    musicOn = !!b;
    if (!ac) return;
    if (!musicOn && music) { stopMusic(music, 0.4); music = null; }
    else if (musicOn && !music && mode !== 'off') music = startMusic(mode);
  }
  // render a song offline (for previews and tests): resolves with an AudioBuffer
  function renderSong(m, seconds, o = {}) {
    const OAC = G.OfflineAudioContext || G.webkitOfflineAudioContext, song = G.Songs && G.Songs.get(m);
    if (!OAC || !song) return Promise.reject(new Error('cannot render ' + m));
    const rate = o.rate || 22050, ctx = new OAC(1, Math.ceil(seconds * rate), rate), out = ctx.createGain();
    out.gain.value = o.gain || 0.5; out.connect(ctx.destination);
    for (let t = 0.05, step = 0; t < seconds; step = (step + 1) % song.total) {
      const d = stepDur(song, o.hot);
      playStep(ctx, out, song, step, t + (step % 2 ? song.swing * d : 0), d, o.hot);
      t += d;
    }
    return ctx.startRendering();
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
    unlock, wake, boost, setMuted, setMusicOn,
    play(name, arg) { if (canPlay() && SFX[name]) SFX[name](arg); },
    music: setMusic,
    // frenzy: the music picks up a little (tempo +6%, an arpeggio, busier hats) until it ends
    intensity(level) { hot = level > 0; },
    get muted() { return muted; },
    get musicOn() { return musicOn; },
    _render: renderSong,
    _state() { return { unlocked: !!ac, mode, boosting: !!boostNodes, ctx: ac, music: music && { m: music.m, step: music.step, song: music.song.name }, hot }; },
  };
})();
