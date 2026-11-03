// Noodle Pit rules — pure game logic with no DOM: who wins a contact, kill streaks, scoring and medals,
// rival personalities, arena hazards and events, the daily challenge and cosmetic unlocks.
// Frames at 60 fps. Loadable in Node for tests.
(() => {
  // ---- contacts: the hybrid rule ----
  // A head touching another worm near ITS head is a head-on clash: the bigger worm wins (ties go to the biter).
  // A head touching anywhere further down a body is a side hit: the biter dies, whatever the sizes — so a
  // small worm can cut in front of a giant and take it down.
  // The Pit King is the exception: he plows through rivals, and a side hit on the player's body only bonks him.
  const HEAD_ZONE = 2.4;   // body points within radius × this of a worm's head count as its head
  function isHeadOn(dx, dy, bodyRadius) { return dx * dx + dy * dy < (bodyRadius * HEAD_ZONE) ** 2; }
  // returns who loses: 'biter' | 'body' | 'bonk' (the King bounced off the player and lost a life)
  function resolveContact(biterLen, bodyLen, headOn, o = {}) {
    if (o.biterKing && !o.bodyPlayer) return 'body';
    if (!headOn) return o.biterKing ? 'bonk' : 'biter';
    return biterLen >= bodyLen ? 'body' : 'biter';
  }

  // ---- kill streaks ----
  const STREAK_WINDOW = 240;   // 4 s between kills keeps a streak alive
  const STREAK_NAMES = ['DOUBLE NOODLE!', 'TRIPLE NOODLE!', 'NOODLE FRENZY!', 'UNSTOPPA-NOODLE!'];
  function streakName(n) { return n < 2 ? '' : STREAK_NAMES[Math.min(n - 2, STREAK_NAMES.length - 1)]; }
  function streakBonus(n) { return n < 2 ? 0 : 4 * (n - 1); }   // extra length per kill, before PACE
  function createStreak(win = STREAK_WINDOW) {
    let n = 0, last = -Infinity, best = 0;
    return {
      hit(t) { n = t - last <= win ? n + 1 : 1; last = t; if (n > best) best = n; return n; },
      count(t) { return t - last <= win ? n : 0; },
      reset() { n = 0; last = -Infinity; best = 0; },
      get best() { return best; },
    };
  }

  // ---- score and medals ----
  const POINTS = { food: 10, kill: 100, perLen: 2, nearMiss: 50, revenge: 300, bonk: 500 };
  function killPoints(victimLen, streak) { return Math.round((POINTS.kill + victimLen * POINTS.perLen) * (1 + 0.5 * Math.max(0, streak - 1))); }
  // finishing under twice the par time earns 10 points per second saved
  function timeBonus(frames, par) { return Math.max(0, Math.round((par * 2 - frames) / 6)); }
  const MEDALS = ['bronze', 'silver', 'gold'], MEDAL_GLYPH = { bronze: '🥉', silver: '🥈', gold: '🥇' };
  function medalFor(frames, par) { return frames <= par ? 'gold' : frames <= par * 1.6 ? 'silver' : 'bronze'; }
  function betterMedal(a, b) { return MEDALS.indexOf(b) > MEDALS.indexOf(a) ? b : a; }

  // ---- rival personalities ----
  // grazer: eats, chases smaller heads · hunter: stalks you and cuts you off · coward: runs from you
  // coiler: circles smaller worms to trap them · thief: hunts death drops and shadows big worms
  const PERSONAS = {
    grazer: { name: 'Grazer' },
    hunter: { name: 'Hunter', range: 650 },
    coward: { name: 'Coward', range: 320 },
    coiler: { name: 'Coiler', range: 340 },
    thief:  { name: 'Thief',  range: 900 },
  };
  const PERSONA_MIX = [
    { grazer: 6, coward: 3, hunter: 1 },
    { grazer: 5, coward: 2, hunter: 2, thief: 1 },
    { grazer: 4, coward: 1, hunter: 2, thief: 2, coiler: 1 },
    { grazer: 3, coward: 1, hunter: 3, thief: 2, coiler: 2 },
    { grazer: 3, hunter: 3, thief: 2, coiler: 2 },
  ];
  function pickPersona(roundIdx, rand = Math.random) {
    const mix = PERSONA_MIX[Math.max(0, Math.min(PERSONA_MIX.length - 1, roundIdx))];
    const tot = Object.values(mix).reduce((a, b) => a + b, 0);
    let x = rand() * tot;
    for (const [k, w] of Object.entries(mix)) { if (x < w) return k; x -= w; }
    return 'grazer';
  }

  // ---- arena: hazards per round, the shrinking wall, and feeding frenzies ----
  // shrink: the wall closes to this fraction of its radius over SHRINK_FRAMES, then holds
  const HAZARDS = [
    { mud: 0, logs: 0, shrink: 1 },
    { mud: 2, logs: 0, shrink: 1 },
    { mud: 3, logs: 0, shrink: 1 },
    { mud: 3, logs: 1, shrink: 0.7 },
    { mud: 2, logs: 2, shrink: 0.75 },
  ];
  const SHRINK_FRAMES = 5400;
  function arenaRadius(base, shrink, frames) { return base - base * (1 - shrink) * Math.min(1, Math.max(0, frames) / SHRINK_FRAMES); }
  const MUD = { r: 150, slow: 0.55 }, LOG = { len: 340, spin: 0.008, w: 9 };
  // distance² from point (px,py) to the segment through (cx,cy) at angle a with half-length h
  function segDist2(px, py, cx, cy, a, h) {
    const dx = Math.cos(a), dy = Math.sin(a), t = Math.max(-h, Math.min(h, (px - cx) * dx + (py - cy) * dy));
    return (px - cx - dx * t) ** 2 + (py - cy - dy * t) ** 2;
  }
  const FRENZY = { every: [1800, 2700], first: 1500, warn: 180, dur: 600, r: 260, rate: 3, maxFood: 110 };
  function frenzyKind(rand = Math.random) { const x = rand(); return x < 0.04 ? 'apple' : x < 0.3 ? 'grub' : 'berry'; }

  // ---- the daily challenge: same seed and modifier for everyone on a given date ----
  function dateKey(d = new Date()) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const DAILY_MODS = [
    { id: 'ghosts', name: 'Ghost Town',     desc: 'Every worm is a ghost: no bites at all, just a race for food.' },
    { id: 'apples', name: 'Orchard',        desc: 'Only golden apples grow. Get fat fast.' },
    { id: 'turbo',  name: 'Turbo Pit',      desc: 'Everything moves a lot faster.' },
    { id: 'giants', name: 'Land of Giants', desc: 'Every rival is huge. Cut them off.' },
    { id: 'tiny',   name: 'Tight Squeeze',  desc: 'A pit half the size, packed with worms.' },
  ];
  function dailyFor(key) { const seed = hashStr('noodle-pit:' + key); return { key, seed, mod: DAILY_MODS[seed % DAILY_MODS.length] }; }
  const DAILY_FRAMES = 3 * 60 * 60;   // a 3-minute run

  // ---- cosmetics beyond skins: hats, trails and death pops; unlocks read a stats object ----
  // stats: { best, eaten, bestStreak, nearMisses, medals, golds, kingBeaten, dailies, endlessBest, deaths }
  const COSMETICS = {
    hat: [
      { id: 'none',  name: 'None',     glyph: '',   need: () => true,               label: 'free' },
      { id: 'cap',   name: 'Cap',      glyph: '🧢', need: s => s.medals >= 1,       label: 'win a medal' },
      { id: 'bow',   name: 'Bow',      glyph: '🎀', need: s => s.nearMisses >= 10,  label: '10 close calls' },
      { id: 'top',   name: 'Top hat',  glyph: '🎩', need: s => s.bestStreak >= 3,   label: 'triple streak' },
      { id: 'flower',name: 'Flower',   glyph: '🌸', need: s => s.dailies >= 1,      label: 'play a daily' },
      { id: 'crown', name: 'Crown',    glyph: '👑', need: s => s.kingBeaten,        label: 'beat the King' },
    ],
    trail: [
      { id: 'none',    name: 'None',    glyph: '·',  need: () => true,               label: 'free' },
      { id: 'sparkle', name: 'Sparkle', glyph: '✨', need: s => s.best >= 120,       label: 'reach length 120' },
      { id: 'bubbles', name: 'Bubbles', glyph: '🫧', need: s => s.eaten >= 15,       label: 'eat 15 worms' },
      { id: 'hearts',  name: 'Hearts',  glyph: '💗', need: s => s.golds >= 3,        label: '3 gold medals' },
      { id: 'fire',    name: 'Fire',    glyph: '🔥', need: s => s.endlessBest >= 5000, label: '5000 in endless' },
    ],
    pop: [
      { id: 'splat',     name: 'Splat',     glyph: '💥', need: () => true,              label: 'free' },
      { id: 'confetti',  name: 'Confetti',  glyph: '🎊', need: s => s.bestStreak >= 2,  label: 'double streak' },
      { id: 'ghost',     name: 'Ghost',     glyph: '👻', need: s => s.deaths >= 20,     label: 'get eaten 20 times' },
      { id: 'fireworks', name: 'Fireworks', glyph: '🎆', need: s => s.bestStreak >= 4,  label: 'streak of 4' },
    ],
  };
  const TAUNTS = ['nom', 'gg', 'too slow', 'yum', "noodle'd", 'mine now', 'bonk'];

  (typeof window !== 'undefined' ? window : globalThis).Rules = {
    HEAD_ZONE, isHeadOn, resolveContact,
    STREAK_WINDOW, streakName, streakBonus, createStreak,
    POINTS, killPoints, timeBonus, MEDALS, MEDAL_GLYPH, medalFor, betterMedal,
    PERSONAS, PERSONA_MIX, pickPersona,
    HAZARDS, SHRINK_FRAMES, arenaRadius, MUD, LOG, segDist2, FRENZY, frenzyKind,
    dateKey, hashStr, mulberry32, DAILY_MODS, dailyFor, DAILY_FRAMES,
    COSMETICS, TAUNTS,
  };
})();
