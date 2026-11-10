// Noodle Pit visual effects — particles, screen shake, screen flash.
// No game or DOM knowledge; time unit is frames (~60 fps). Loadable in Node for tests.
(() => {
  const CAP = 400, SCREEN_CAP = 120, TEXT_CAP = 24;
  const parts = [], screenParts = [], texts = [];
  const banner = { text: '', color: '#fff', t: 0, T: 0, sub: '' };
  // where the banner's text baseline may start (screen px); the game sets it just below the HUD / boss bar
  const shake = { t: 0, T: 0, mag: 0 };
  const flash = { color: null, t: 0 };
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function push(arr, cap, p) { if (arr.length >= cap) arr.shift(); arr.push(p); }
  function step(arr) {
    for (let i = arr.length - 1; i >= 0; i--) {
      const p = arr[i];
      p.x += p.vx; p.y += p.vy;
      if (p.g) p.vy += p.g;
      p.vx *= 0.96; p.vy *= 0.96;
      if (--p.life <= 0) arr.splice(i, 1);
    }
  }
  function drawParts(ctx, arr) {
    for (const p of arr) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.c;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  const FX = {
    enabled: true,
    parts, screenParts, CAP, SCREEN_CAP,
    _state: { shake, flash },
    burst(x, y, n, color, o = {}) {
      if (!FX.enabled) return;
      const speed = o.speed ?? 2.5, life = o.life ?? 36, r = o.r ?? 2.5;
      for (let i = 0; i < n; i++) {
        const a = rnd(0, Math.PI * 2), s = speed * rnd(0.4, 1);
        push(parts, CAP, { x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, c: color, r: r * rnd(0.6, 1.3) });
      }
    },
    confetti(cx, cy, n, colors) {
      if (!FX.enabled) return;
      for (let i = 0; i < n; i++) {
        const a = rnd(-Math.PI * 0.85, -Math.PI * 0.15), s = rnd(3, 9);
        push(screenParts, SCREEN_CAP, { x: cx, y: cy, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 90, max: 90, c: colors[i % colors.length], r: rnd(2.5, 5), g: 0.18 });
      }
    },
    shake(mag, frames) {
      if (!FX.enabled) return;
      if (shake.t <= 0 || mag >= shake.mag) { shake.mag = mag; shake.T = frames; shake.t = frames; }
    },
    shakeOffset() {
      if (shake.t <= 0) return { x: 0, y: 0 };
      const k = shake.mag * shake.t / shake.T;
      return { x: rnd(-1, 1) * k, y: rnd(-1, 1) * k };
    },
    flash(color, frames) { if (!FX.enabled) return; flash.color = color; flash.t = frames; },
    // world-space floating text ("Close!", "+12") that rises and fades
    text(x, y, str, color = '#fff', o = {}) {
      if (!FX.enabled) return;
      const life = o.life ?? 50;
      push(texts, TEXT_CAP, { x, y, vy: o.vy ?? -0.7, str, c: color, size: o.size ?? 14, life, max: life });
    },
    // one big screen-space banner at a time ("TRIPLE NOODLE!"); a new one replaces the old
    banner(str, color = '#fff', frames = 90, sub = '') { if (!FX.enabled) return; banner.text = str; banner.color = color; banner.t = banner.T = frames; banner.sub = sub; },
    texts, _banner: banner, bannerTop: null,
    update() {
      step(parts); step(screenParts);
      for (let i = texts.length - 1; i >= 0; i--) { const t = texts[i]; t.y += t.vy; if (--t.life <= 0) texts.splice(i, 1); }
      if (banner.t > 0) banner.t--;
      if (shake.t > 0) shake.t--;
      if (flash.t > 0) flash.t--;
    },
    drawWorld(ctx) {
      drawParts(ctx, parts);
      ctx.textAlign = 'center';
      for (const t of texts) {
        ctx.globalAlpha = Math.min(1, 2 * t.life / t.max); ctx.font = `800 ${t.size}px sans-serif`;
        ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillText(t.str, t.x + 1, t.y + 2);
        ctx.fillStyle = t.c; ctx.fillText(t.str, t.x, t.y);
      }
      ctx.globalAlpha = 1;
    },
    drawScreen(ctx, W, H) {
      drawParts(ctx, screenParts);
      if (banner.t > 0) {
        // pop in over 8 frames, fade over the last 20
        const age = banner.T - banner.t, k = Math.min(1, age / 8), s = 0.6 + 0.4 * k + 0.12 * Math.sin(Math.min(1, age / 12) * Math.PI);
        const size = Math.min(44, W / 11, H / 10);
        // below the HUD when the game says where that ends, else 30% down; never lower than 40% (keeps it off the action)
        const y = FX.bannerTop != null ? Math.min(H * 0.4, FX.bannerTop + size) : H * 0.3;
        ctx.save(); ctx.globalAlpha = Math.min(1, banner.t / 20); ctx.translate(W / 2, y); ctx.scale(s, s);
        ctx.textAlign = 'center'; ctx.font = `900 ${size}px sans-serif`;
        ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillText(banner.text, 2, 3);
        ctx.fillStyle = banner.color; ctx.fillText(banner.text, 0, 0);
        if (banner.sub) { ctx.font = `700 ${size * 0.38}px sans-serif`; ctx.fillStyle = '#fbf3e4'; ctx.fillText(banner.sub, 0, size * 0.62); }
        ctx.restore();
      }
      if (flash.t > 0 && flash.color) { ctx.fillStyle = flash.color; ctx.fillRect(0, 0, W, H); }
    },
    clear() { parts.length = 0; screenParts.length = 0; texts.length = 0; banner.t = 0; shake.t = 0; shake.mag = 0; flash.t = 0; },
  };
  (typeof window !== 'undefined' ? window : globalThis).FX = FX;
})();
