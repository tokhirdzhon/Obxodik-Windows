'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'ui', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ui', 'app.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.js'), 'utf8');

test('every DOM id used by the renderer exists in HTML', () => {
  const ids = [...app.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]);
  const missing = [...new Set(ids)].filter((id) => !html.includes(`id="${id}"`));
  assert.deepStrictEqual(missing, []);
});

test('every bridge method used by the renderer exists in preload', () => {
  const exposed = new Set(
    [...preload.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]),
  );
  const used = new Set(
    [...app.matchAll(/api\.(\w+)\(/g)].map((m) => m[1]),
  );
  const missing = [...used].filter((name) => !exposed.has(name));
  assert.deepStrictEqual(missing, []);
});

test('renderer has no inline event handlers blocked by CSP', () => {
  assert.doesNotMatch(html, /\son(click|change|load|error)\s*=/i);
});

test('connectivity check uses the promise DNS API', () => {
  const main = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
  assert.match(main, /dns\.promises\.lookup\(/);
  assert.doesNotMatch(main, /(^|[^.\w])dns\.lookup\(/m);
});
