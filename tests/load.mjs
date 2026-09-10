import fs from 'node:fs';
import vm from 'node:vm';

// Run a classic (non-module) script in Node's global scope, as a browser <script> tag would.
export function loadScript(relPath) {
  const url = new URL('../' + relPath, import.meta.url);
  vm.runInThisContext(fs.readFileSync(url, 'utf8'), { filename: relPath });
}
