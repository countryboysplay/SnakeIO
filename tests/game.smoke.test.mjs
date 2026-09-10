import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadScript } from './load.mjs';
import { installDom } from './dom-stub.mjs';

// Use the real markup so element ids stay in sync with index.html.
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script'));

const dom = installDom({ html: body });
loadScript('audio.js');
loadScript('fx.js');
loadScript('items.js');
loadScript('game.js');

test('boots to the title screen and renders idle frames without errors', () => {
  dom.frame(30);
  assert.ok(dom.el('start'), 'a Play button should exist');
  assert.ok(dom.el('overlay').classList.contains('show'), 'title overlay should be shown');
  assert.ok(dom.el('overlay').innerHTML.includes('Add to Home Screen'), 'install hint shows outside standalone mode');
});

test('starts a round, steers and boosts through several seconds of play', () => {
  dom.el('start').onclick();
  assert.equal(dom.el('overlay').classList.contains('show'), false, 'overlay hides when a round starts');
  assert.equal(dom.el('boost').style.display, 'flex');
  dom.frame(60);
  const stick = dom.el('stick');
  stick.dispatch('mousedown', { clientX: 140, clientY: 720 });   // push the joystick right
  dom.fireWindow('mousemove', { clientX: 140, clientY: 700 });
  dom.fireWindow('keydown', { code: 'Space' });                  // boost
  dom.frame(240);
  dom.fireWindow('keyup', { code: 'Space' });
  dom.fireWindow('mouseup', {});
  dom.frame(240);
  const len = +dom.el('len').textContent;
  assert.ok(Number.isFinite(len) && len > 0, `HUD length should be a number, got "${dom.el('len').textContent}"`);
  const food = globalThis.NoodleDebug.state().food, kinds = new Set(food.map(f => f.kind));
  assert.ok(kinds.has('crumb') && kinds.has('berry'), `food has tiers (saw ${[...kinds].join(',')})`);
  assert.ok(food.filter(f => f.kind === 'apple').length <= 2, 'apple cap');
  assert.ok(food.every(f => Number.isFinite(f.v) && Number.isFinite(f.r)), 'every food item carries v and r');
});

test('round label was populated from ROUNDS and HUD best mirrors storage', () => {
  assert.equal(dom.el('roundNum').textContent, 1);
  assert.equal(dom.el('roundName').textContent, 'Hatchling');
  const stored = dom.storage.has('noodleBest') ? +dom.storage.get('noodleBest') : 0;
  assert.equal(+dom.el('best').textContent, stored, 'the #best span must stay attached and live');
});

test('mute button toggles glyph and persists; M key toggles too', () => {
  const mute = dom.el('mute');
  assert.equal(mute.textContent, '🔊');
  mute.dispatch('pointerdown', {});
  assert.equal(mute.textContent, '🔇');
  assert.equal(dom.storage.get('noodleMuted'), '1');
  dom.fireWindow('keydown', { code: 'KeyM' });
  assert.equal(mute.textContent, '🔊');
  assert.equal(dom.storage.get('noodleMuted'), '0');
});

test('running the wall kills the player and progress is written to localStorage', () => {
  // Steer hard in one direction with boost until the arena wall ends the run (or 40 s pass).
  const stick = dom.el('stick');
  stick.dispatch('mousedown', { clientX: 190, clientY: 747 });
  dom.fireWindow('keydown', { code: 'Space' });
  dom.frame(2400);   // ~40 s: boosting straight at ~5.7 px/frame reaches the 2200 px wall well within this
  dom.fireWindow('keyup', { code: 'Space' });
  dom.fireWindow('mouseup', {});
  assert.ok(dom.storage.has('noodleBest') || dom.storage.has('noodleEaten'), 'gameOver should persist best/eaten');
  const ov = dom.el('overlay');
  assert.ok(ov.classList.contains('show'), 'game-over overlay is shown');
  assert.ok(ov.innerHTML.includes('Eaten') && ov.innerHTML.includes('Retry round'), 'game-over template rendered');
  assert.ok(ov.querySelector('.score'), 'score element present for count-up');
  assert.equal(dom.el('boost').style.display, 'none');
});

test('pause freezes the run, resume continues it, tab-hide auto-pauses, quit returns to title', () => {
  // Rivals spawn ≥200 px from the player and move ~2.6 px/frame, so within a handful of frames
  // no collision is possible — keeping this test deterministic without seeding Math.random.
  dom.el('start').onclick();                       // retry
  dom.frame(2);
  const ov = dom.el('overlay'), pauseBtn = dom.el('pause');
  assert.equal(pauseBtn.hidden, false, 'pause button visible during play');
  assert.equal(ov.inert, true, 'hidden overlay is inert so its buttons cannot be re-triggered');
  const lenBefore = dom.el('len').textContent;
  dom.fireWindow('keydown', { code: 'KeyP', repeat: true });
  assert.equal(ov.classList.contains('show'), false, 'auto-repeated P is ignored');
  dom.fireWindow('keydown', { code: 'KeyP' });
  assert.ok(ov.classList.contains('show') && ov.innerHTML.includes('Paused'));
  assert.equal(pauseBtn.hidden, true);
  assert.equal(ov.inert, false);
  dom.frame(120);
  assert.equal(dom.el('len').textContent, lenBefore, 'no simulation while paused');
  dom.el('resume').onclick();
  assert.equal(ov.classList.contains('show'), false, 'resume hides the overlay');
  dom.frame(2);
  document.visibilityState = 'hidden'; dom.fireWindow('visibilitychange'); document.visibilityState = 'visible';
  assert.ok(ov.innerHTML.includes('Paused'), 'hiding the tab pauses');
  const eatenBefore = dom.storage.get('noodleEaten');
  dom.el('quit').onclick();
  assert.ok(ov.classList.contains('show') && ov.innerHTML.includes('Noodle Pit'), 'quit shows the title screen');
  assert.equal(dom.storage.get('noodleEaten'), eatenBefore, 'quit is not a death');
  dom.frame(10);
});

test('power-ups: collect → effect + HUD pill; magnet pulls; speed suspends drain; shield survives the wall', () => {
  const D = globalThis.NoodleDebug;
  dom.el('start').onclick(); dom.frame(2);
  D.spawnPickup('magnet'); dom.frame(1);
  let st = D.state();
  assert.ok(st.effects.has('magnet'), 'pickup at the head is collected next frame');
  assert.ok(dom.el('buffs').innerHTML.includes('🧲'), 'HUD shows the buff');
  st.food.push({ x: st.player.x + 100, y: st.player.y, kind: 'crumb', v: 1, r: 3, c: '#fff', ph: 0 });
  const f = st.food[st.food.length - 1], d0 = Math.hypot(f.x - st.player.x, f.y - st.player.y);
  dom.frame(3);
  assert.ok(Math.hypot(f.x - D.state().player.x, f.y - D.state().player.y) < d0, 'magnet pulls food toward the head');
  D.spawnPickup('speed'); dom.frame(1); assert.ok(D.state().effects.has('speed'));
  const len0 = D.state().player.len;
  dom.fireWindow('keydown', { code: 'Space' }); dom.frame(20); dom.fireWindow('keyup', { code: 'Space' });
  assert.ok(D.state().player.len >= len0, 'speed buff suspends boost drain');
  D.spawnPickup('shield'); dom.frame(1); assert.ok(D.state().effects.has('shield'));
  const p = D.state().player; p.x = 2190; p.y = 0; p.ang = 0; D.steer(0); dom.frame(6);
  st = D.state();
  assert.equal(st.player.dead, false, 'shield saves from the wall');
  assert.equal(st.effects.has('shield'), false, 'shield is consumed');
  assert.ok(Math.hypot(st.player.x, st.player.y) <= 2200 && st.running, 'player is back inside and still running');
  assert.ok(st.effects.has('ghost'), 'a shield save phases the player out briefly');
  dom.fireWindow('keydown', { code: 'KeyP' }); dom.el('quit').onclick(); dom.frame(2);
});

test('shield saves from a worm bite without feeding the attacker; buffs clear on game over', () => {
  const D = globalThis.NoodleDebug;
  dom.el('start').onclick(); dom.frame(2);
  D.spawnPickup('shield'); dom.frame(1);
  let st = D.state();
  // park a much bigger rival's head inside the player's body
  const rival = st.worms.find(w => w.ai && !w.dead), body = st.player.pts[3];
  rival.len = 100; rival.x = body.x; rival.y = body.y; rival.pts[0] = { x: body.x, y: body.y };
  dom.frame(1);
  st = D.state();
  assert.equal(st.player.dead, false, 'shield absorbs the bite');
  assert.equal(st.effects.has('shield'), false, 'shield consumed');
  assert.equal(rival.len, 100, 'the biter is not credited with a meal');
  dom.frame(3);
  assert.equal(D.state().player.dead, false, 'ghost grace stops the re-bite on the following frames');
  // now die for real (wall) and confirm the HUD pills are gone
  D.spawnPickup('magnet'); dom.frame(1); assert.ok(dom.el('buffs').innerHTML.includes('🧲'));
  const p = D.state().player; p.x = 2190; p.y = 0; p.ang = 0; D.steer(0); dom.frame(60);
  st = D.state();
  assert.equal(st.running, false, 'run ended');
  assert.equal(dom.el('buffs').innerHTML, '', 'buff pills cleared on game over');
});
