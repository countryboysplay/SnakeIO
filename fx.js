// Noodle Pit visual effects — particles, screen shake, screen flash.
// No game or DOM knowledge; time unit is frames (~60 fps). Loadable in Node for tests.
(() => {
  const CAP = 400, SCREEN_CAP = 120;
  const parts = [], screenParts = [];
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
    update() {
      step(parts); step(screenParts);
      if (shake.t > 0) shake.t--;
      if (flash.t > 0) flash.t--;
    },
    drawWorld(ctx) { drawParts(ctx, parts); },
    drawScreen(ctx, W, H) {
      drawParts(ctx, screenParts);
      if (flash.t > 0 && flash.color) { ctx.fillStyle = flash.color; ctx.fillRect(0, 0, W, H); }
    },
    clear() { parts.length = 0; screenParts.length = 0; shake.t = 0; shake.mag = 0; flash.t = 0; },
  };
  (typeof window !== 'undefined' ? window : globalThis).FX = FX;
})();
