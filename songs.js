// Noodle Pit songs — the music as data, played by audio.js's sequencer. Pure (no Web Audio), loadable in Node.
//
// Every part is written on a 16th-note grid, 16 steps a bar, bars separated by "|":
//   lead:  a note ("E5", "C#6", "Bb4") starts on that step, "-" holds it, "." is a rest
//   bass:  degrees of that bar's chord, an octave down: R root, 3 third, 5 fifth, 7 seventh, 8 octave; "-" hold, "." rest
//   pad:   "x" plays the bar's chord, "-" holds it, "." rest (one pattern, repeated every bar)
//   drums: k kick, s snare, h hat — one bar each, repeated; `fill` replaces the snare on fill bars
(() => {
  const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  // "A4" → 69 (MIDI), "C#5" → 73, "Bb4" → 70
  function midi(name) {
    const m = /^([A-G])(#|b)?(-?\d)$/.exec(name); if (!m) throw new Error('bad note ' + name);
    return 12 * (+m[3] + 1) + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  }
  const freq = n => 440 * Math.pow(2, (n - 69) / 12);
  const QUALITY = { '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10] };
  // "Am7" → { root: 9 (pitch class), tones: [0,3,7,10] }
  function chord(name) {
    const m = /^([A-G])(#|b)?(m7|maj7|m|7)?$/.exec(name); if (!m) throw new Error('bad chord ' + name);
    return { root: (NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12, tones: QUALITY[m[3] || ''] };
  }
  const tokens = s => s.trim().split(/\s+/);
  const bars = s => s.split('|').map(tokens);

  // turn a grid of tokens into note events: { step, len, value } where len counts the held "-" steps too
  function events(grid, valueOf) {
    const flat = grid.flat(), out = [];
    for (let i = 0; i < flat.length; i++) {
      const t = flat[i]; if (t === '-' || t === '.') continue;
      let len = 1; while (flat[i + len] === '-') len++;
      out.push({ step: i, len, value: valueOf(t, i) });
    }
    return out;
  }

  // compile a song into per-step lookups the sequencer can read cheaply
  function compile(song) {
    const nBars = song.chords.length, total = nBars * 16;
    const chords = song.chords.map(chord);
    const chordAt = step => chords[Math.floor(step / 16) % nBars];
    const lead = events(bars(song.lead), t => midi(t));
    const bassGrid = bars(song.bass); while (bassGrid.length < nBars) bassGrid.push(...bars(song.bass));
    const bass = events(bassGrid.slice(0, nBars), (t, i) => {
      const c = chordAt(i), base = 36 + c.root;   // C2 = 36
      const deg = { R: 0, 3: c.tones[1], 5: 7, 7: c.tones[3] ?? 10, 8: 12 }[t];
      if (deg == null) throw new Error('bad bass token ' + t);
      return base + deg;
    });
    const padBar = tokens(song.pad), pad = events(Array.from({ length: nBars }, () => padBar), (t, i) => {
      const c = chordAt(i); return c.tones.map(x => 60 + ((c.root + x) % 12));   // close voicing around C4
    });
    const at = list => { const a = new Array(total).fill(null); for (const e of list) a[e.step] = e; return a; };
    const k = tokens(song.drums.k), s = tokens(song.drums.s), h = tokens(song.drums.h), fill = song.drums.fill ? tokens(song.drums.fill) : null;
    const fillBars = new Set(song.drums.fillBars || []);
    const hit = (pat, i) => pat[i % 16] === 'x';
    return {
      name: song.name, bpm: song.bpm, swing: song.swing || 0, total, voice: song.voice,
      lead: at(lead), bass: at(bass), pad: at(pad),
      chordTones: step => { const c = chordAt(step); return c.tones.map(x => c.root + x); },
      kick: i => hit(k, i), hat: i => hit(h, i),
      snare: i => (fill && fillBars.has(Math.floor(i / 16) % nBars) ? hit(fill, i) : hit(s, i)),
      _check: { leadSteps: bars(song.lead).flat().length, bassSteps: bassGrid.slice(0, nBars).flat().length, padSteps: padBar.length, drumSteps: [k, s, h].map(p => p.length) },
    };
  }

  const SONGS = {
    // menus: a slow, swung lounge loop
    menu: {
      name: 'Noodle Lounge', bpm: 88, swing: 0.14,
      voice: { lead: 'triangle', leadCut: 2600, leadGain: 0.30, padGain: 0.10, bassGain: 0.42, drums: 0.45 },
      chords: ['Cmaj7', 'Am7', 'Dm7', 'G7', 'Cmaj7', 'Am7', 'Fmaj7', 'G7'],
      lead: `G5 - - - E5 - - - . . . . D5 - E5 - |
             C5 - - - - - - - . . A4 - C5 - E5 - |
             F5 - - - E5 - D5 - . . . . A4 - C5 - |
             B4 - - - - - - - . . . . . . . . |
             G5 - - - E5 - - - . . . . G5 - A5 - |
             C6 - - - B5 - A5 - G5 - - - E5 - - - |
             F5 - - - A5 - - - G5 - F5 - E5 - D5 - |
             D5 - - - - - - - . . . . . . . .`,
      bass: `R - - - . . 5 - 8 - - - 5 . . .`,
      pad: `x - - - - - - - - - - - - - - -`,
      drums: { k: 'x . . . . . . . x . . x . . . .', s: '. . . . x . . . . . . . x . . .', h: '. . x . . . x . . . x . . . x .' },
    },
    // the main theme: bright and bouncy, an 8-bar hook and an 8-bar answer
    play: {
      name: 'Wiggle Run', bpm: 124,
      voice: { lead: 'square', leadCut: 2400, leadGain: 0.16, padGain: 0.07, bassGain: 0.45, drums: 0.6 },
      chords: ['C', 'G', 'Am', 'F', 'C', 'G', 'F', 'G', 'Am', 'F', 'C', 'G', 'Am', 'F', 'G', 'G'],
      lead: `E5 - G5 - C6 - B5 - G5 - - - E5 - . . |
             D5 - G5 - B5 - A5 - G5 - - - D5 - . . |
             C5 - E5 - A5 - G5 - E5 - - - C5 - D5 - |
             E5 - - - D5 - C5 - A4 - - - . . . . |
             E5 - G5 - C6 - B5 - G5 - - - E5 - G5 - |
             A5 - G5 - F5 - E5 - D5 - - - B4 - D5 - |
             C5 - A4 - C5 - F5 - E5 - D5 - C5 - A4 - |
             B4 - - - D5 - - - G5 - - - . . . . |
             A5 . A5 . G5 - E5 - . . E5 - G5 - A5 - |
             C6 - A5 - . . F5 - . . A5 - G5 - F5 - |
             E5 - G5 - . . C6 - . . G5 - E5 - G5 - |
             D5 - - - B4 - D5 - G5 - - - . . . . |
             A5 . A5 . B5 - C6 - . . B5 - A5 - G5 - |
             A5 - F5 - . . C5 - . . F5 - A5 - C6 - |
             B5 - - - A5 - G5 - F5 - E5 - D5 - B4 - |
             G5 - - - - - - - . . . . D5 . E5 .`,
      bass: `R . R . 5 . R . R . R . 5 . 8 .`,
      pad: `. . x . . . x . . . x . . . x .`,
      drums: { k: 'x . . . . . . . x . x . . . . .', s: '. . . . x . . . . . . . x . . .', h: 'x . x . x . x . x . x . x . x .',
               fill: '. . . . x . . . x . x x x x x x', fillBars: [7, 15] },
    },
    // the Pit King: minor, driving, with the harmonic-minor E chord for menace
    king: {
      name: 'Pit King', bpm: 136,
      voice: { lead: 'sawtooth', leadCut: 1900, leadGain: 0.12, padGain: 0.07, bassGain: 0.42, drums: 0.58 },
      chords: ['Am', 'F', 'G', 'E', 'Am', 'F', 'Dm', 'E'],
      lead: `A5 - - - E5 - A5 - C6 - B5 - A5 - E5 - |
             F5 - - - C5 - F5 - A5 - G5 - F5 - C5 - |
             G5 - - - D5 - G5 - B5 - A5 - G5 - D5 - |
             G#5 - - - - - B5 - - - E6 - - - . . |
             A5 . A5 . C6 . A5 . E6 - D6 - C6 - B5 - |
             A5 . A5 . C6 . A5 . F6 - E6 - D6 - C6 - |
             D6 - C6 - A5 - F5 - D5 - F5 - A5 - D6 - |
             B5 - - - G#5 - - - E5 - - - . . E5 .`,
      bass: `R R 8 R R R 8 R R R 8 R 5 5 8 5`,
      pad: `x - . . . . x - . . . . . . . .`,
      drums: { k: 'x . . . x . . . x . . . x . x .', s: '. . . . x . . . . . . . x . . .', h: 'x . x x x . x x x . x x x . x x',
               fill: '. . . . x . . . x x . x x x x x', fillBars: [7] },
    },
  };

  const compiled = {};
  function get(name) { return compiled[name] || (compiled[name] = SONGS[name] ? compile(SONGS[name]) : null); }

  (typeof window !== 'undefined' ? window : globalThis).Songs = { SONGS, get, compile, midi, freq, chord };
})();
