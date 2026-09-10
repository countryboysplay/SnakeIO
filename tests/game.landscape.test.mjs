import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadScript } from './load.mjs';
import { installDom } from './dom-stub.mjs';

// Same boot as the smoke test, but with the phone held sideways.
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const dom = installDom({ html: html.slice(html.indexOf('<body>') + 6, html.indexOf('<script')), width: 844, height: 390 });
for (const f of ['audio.js', 'fx.js', 'items.js', 'game.js']) loadScript(f);

test('boots and plays in landscape (844×390) without errors; overlay uses column blocks', () => {
  dom.frame(10);
  const ov = dom.el('overlay').innerHTML;
  assert.ok(ov.includes('class="col main"') && ov.includes('class="col side"'), 'title screen is split into main/side columns');
  dom.el('start').onclick();
  dom.el('stick').dispatch('mousedown', { clientX: 120, clientY: 300 });
  dom.frame(300);
  assert.ok(Number.isFinite(+dom.el('len').textContent));
  dom.fireWindow('keydown', { code: 'KeyP' });
  assert.ok(dom.el('overlay').innerHTML.includes('class="col main"'), 'pause screen also uses the column block');
});
