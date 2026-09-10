// Noodle Pit item data — food tiers, power-ups, effect timers. Pure data + logic, no DOM. Frames at 60 fps.
(() => {
  const FOOD = {
    crumb: { v: 1,  r: 3,   w: 80 },
    berry: { v: 3,  r: 4.5, w: 14 },
    grub:  { v: 5,  r: 5.5, w: 5  },
    apple: { v: 15, r: 7,   w: 1, max: 2 },
    chunk: { v: 2,  r: 4 },                 // dropped by dead worms, never spawned
  };
  const SPAWN = Object.entries(FOOD).filter(([, k]) => k.w);
  const TOTAL_W = SPAWN.reduce((s, [, k]) => s + k.w, 0);
  function pickFood(rand = Math.random, appleCount = 0) {
    let x = rand() * TOTAL_W;
    for (const [name, k] of SPAWN) { if (x < k.w) return name === 'apple' && appleCount >= FOOD.apple.max ? 'crumb' : name; x -= k.w; }
    return 'crumb';
  }
  function avgFoodValue() { return SPAWN.reduce((s, [, k]) => s + k.v * k.w, 0) / TOTAL_W; }

  const POWERUPS = {
    speed:  { glyph: '⚡', c: '#5cc8ff', dur: 360  },   // 6 s: boost speed, no length cost
    shield: { glyph: '🛡', c: '#c9f24a', dur: 1200 },   // 20 s or until it absorbs a hit
    ghost:  { glyph: '👻', c: '#e9e4ff', dur: 300  },   // 5 s: pass through worms
    magnet: { glyph: '🧲', c: '#ff5d4a', dur: 480  },   // 8 s: pull nearby food
  };
  const KINDS = Object.keys(POWERUPS);
  function pickPowerup(rand = Math.random) { return KINDS[Math.min(KINDS.length - 1, rand() * KINDS.length | 0)]; }
  const PICKUP = { interval: [720, 1200], ttl: 1800, blinkAt: 300, minDist: 300, first: 600 };

  // per-kind countdown timers; tick() reports kinds that just ran out
  function createEffects() {
    const t = {};   // kind -> { left, total }
    return {
      add(kind, frames) { t[kind] = { left: frames, total: frames }; },
      has(kind) { return !!t[kind]; },
      frac(kind) { return t[kind] ? t[kind].left / t[kind].total : 0; },
      tick() { const out = []; for (const k of KINDS) { const e = t[k]; if (!e) continue; if (--e.left <= 0) { delete t[k]; out.push(k); } } return out; },
      consume(kind) { delete t[kind]; },
      clear() { for (const k of Object.keys(t)) delete t[k]; },
      active() { return KINDS.filter(k => t[k]).map(k => ({ kind: k, frac: t[k].left / t[k].total })); },
    };
  }
  (typeof window !== 'undefined' ? window : globalThis).Items = { FOOD, pickFood, avgFoodValue, POWERUPS, pickPowerup, PICKUP, createEffects };
})();
