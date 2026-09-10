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
loadScript('game.js');

test('boots to the title screen and renders idle frames without errors', () => {
  dom.frame(30);
  assert.ok(dom.el('start'), 'a Play button should exist');
});

test('starts a round, steers and boosts through several seconds of play', () => {
  dom.el('start').onclick();
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
});

test('round label was populated from ROUNDS and HUD best mirrors storage', () => {
  assert.equal(dom.el('roundNum').textContent, 1);
  assert.equal(dom.el('roundName').textContent, 'Hatchling');
  const stored = dom.storage.has('noodleBest') ? +dom.storage.get('noodleBest') : 0;
  assert.equal(+dom.el('best').textContent, stored, 'the #best span must stay attached and live');
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
});
