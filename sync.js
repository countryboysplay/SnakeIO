// Noodle Pit party sync — packs the host's world into compact snapshots for guest phones and rebuilds smooth
// worms from them. Pure data + math, no DOM, loadable in Node for tests.
//
// The host simulates everything and sends each guest a snapshot every STEP ticks (15/s), only for what is near that
// guest's camera. Bodies are sent as every STEP-th point, chosen by absolute tick (snapshots go out when
// tick % STEP === 0), so the points in consecutive snapshots are the same world points: the guest only has to slide
// the head forward between them, and the rest of the body never jitters.
(() => {
  const STEP = 4;
  const FOOD_KINDS = ['crumb', 'berry', 'grub', 'apple', 'chunk'];
  const POWERUPS = ['speed', 'shield', 'ghost', 'magnet'];
  const PERSONAS = ['', 'grazer', 'hunter', 'coward', 'coiler', 'thief', 'king'];
  const F = { boost: 1, ghost: 2, king: 4, nemesis: 8, fleeing: 16, human: 32, stun: 64 };
  const r1 = v => Math.round(v * 10) / 10;

  // ---- worms ----
  // [id, x, y, ang, len, color, skin|0, persona, flags, name|0, taunt|0, bodyDeltas]
  // bodyDeltas: x0,y0 of the first sent point (whole px), then integer deltas to each next one
  function packWorm(s, flags) {
    const pts = s.pts, body = [];
    let px = 0, py = 0;
    for (let i = 0; i < pts.length; i += STEP) {
      const x = Math.round(pts[i].x), y = Math.round(pts[i].y);
      if (i === 0) body.push(x, y); else body.push(x - px, y - py);
      px = x; py = y;
    }
    return [s.id, r1(s.x), r1(s.y), Math.round(s.ang * 100) / 100, s.len, s.c, s.skin ? [s.skin.c, s.skin.c2 || 0, s.skin.type] : 0,
      PERSONAS.indexOf(s.persona || '') | 0, flags | 0, s.name || 0, s.tauntText || 0, body];
  }
  function unpackWorm(a) {
    const [id, x, y, ang, len, c, sk, p, flags, name, taunt, d] = a, body = [];
    let bx = 0, by = 0;
    for (let i = 0; i < d.length; i += 2) { bx = i ? bx + d[i] : d[i]; by = i ? by + d[i + 1] : d[i + 1]; body.push({ x: bx, y: by }); }
    return { id, x, y, ang, len, c, skin: sk ? { c: sk[0], c2: sk[1] || undefined, type: sk[2] } : null, persona: PERSONAS[p] || null,
      flags, name: name || null, taunt: taunt || null, body };
  }

  // Render-ready points for a worm between two snapshots. `body` is the newest snapshot's sent points (body[0] is
  // the head at that tick), `a` in [0,1] is how far we are from the previous snapshot to this one. Rendering runs one
  // snapshot behind, so the head sits between body[1] (the previous head) and body[0], and the gaps are filled back in
  // at the original one-point-per-tick spacing.
  function renderPts(body, a) {
    const n = body.length; if (!n) return [];
    if (n === 1) return [{ x: body[0].x, y: body[0].y }];
    a = Math.max(0, Math.min(1, a));
    const b0 = body[0], b1 = body[1];
    const out = [{ x: b1.x + (b0.x - b1.x) * a, y: b1.y + (b0.y - b1.y) * a }];
    const lead = Math.round(a * STEP);   // points between the moving head and body[1]
    for (let k = lead - 1; k >= 1; k--) { const t = k / lead; out.push({ x: b1.x + (out[0].x - b1.x) * t, y: b1.y + (out[0].y - b1.y) * t }); }
    for (let i = 1; i < n; i++) {
      const p = body[i], q = body[i + 1];
      out.push({ x: p.x, y: p.y });
      if (q) for (let k = 1; k < STEP; k++) { const t = k / STEP; out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }); }
    }
    return out;
  }
  function lerpAngle(a, b, t) { let d = b - a; d = Math.atan2(Math.sin(d), Math.cos(d)); return a + d * t; }

  // ---- food and pickups ----
  // food: flat [x, y, kind, colour] per pellet; colour is a palette index for crumbs, a string for chunks, 0 otherwise
  function packFood(list, palette, inView) {
    const out = [];
    for (const f of list) {
      if (!inView(f.x, f.y)) continue;
      const k = FOOD_KINDS.indexOf(f.kind), pi = palette.indexOf(f.c);
      out.push(Math.round(f.x), Math.round(f.y), k, f.kind === 'crumb' && pi >= 0 ? pi : f.kind === 'chunk' || f.kind === 'crumb' ? f.c : 0);
    }
    return out;
  }
  function unpackFood(a, palette, fixedColors, table) {
    const out = [];
    for (let i = 0; i < a.length; i += 4) {
      const kind = FOOD_KINDS[a[i + 2]] || 'crumb', k = table[kind], c = a[i + 3];
      out.push({ x: a[i], y: a[i + 1], kind, v: k.v, r: k.r, c: typeof c === 'number' && kind === 'crumb' ? palette[c] : typeof c === 'string' ? c : fixedColors[kind], ph: (a[i] * 7 + a[i + 1] * 13) % 6.28 });
    }
    return out;
  }
  function packPickups(list, tick) { const out = []; for (const p of list) out.push(Math.round(p.x), Math.round(p.y), POWERUPS.indexOf(p.kind), tick - p.born); return out; }
  function unpackPickups(a, tick) { const out = []; for (let i = 0; i < a.length; i += 4) out.push({ x: a[i], y: a[i + 1], kind: POWERUPS[a[i + 2]], born: tick - a[i + 3] }); return out; }

  // a rectangle around (cx,cy) half-size (hw,hh) plus a margin
  function viewTest(cx, cy, hw, hh, m = 80) { return (x, y) => Math.abs(x - cx) < hw + m && Math.abs(y - cy) < hh + m; }
  // does any sampled body point fall in view? (cheap test for whether to send a worm at all)
  function wormInView(s, inView) {
    if (inView(s.x, s.y)) return true;
    for (let i = 0; i < s.pts.length; i += 8) if (inView(s.pts[i].x, s.pts[i].y)) return true;
    return false;
  }

  // a 4-letter room code without easily confused letters (no I, O)
  const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  function makeCode(rand = Math.random) { let s = ''; for (let i = 0; i < 4; i++) s += CODE_ALPHABET[rand() * CODE_ALPHABET.length | 0]; return s; }
  function cleanCode(s) { return String(s || '').toUpperCase().replace(/[^A-Z]/g, '').replace(/[IO]/g, '').slice(0, 4); }

  (typeof window !== 'undefined' ? window : globalThis).Sync = {
    STEP, FOOD_KINDS, POWERUPS, PERSONAS, F,
    packWorm, unpackWorm, renderPts, lerpAngle,
    packFood, unpackFood, packPickups, unpackPickups, viewTest, wormInView,
    makeCode, cleanCode, CODE_ALPHABET,
  };
})();
