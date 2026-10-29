'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ConfigStore, DEFAULTS } = require('../electron/config-store');

test('config falls back to safe defaults on broken JSON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obxodik-config-'));
  fs.writeFileSync(path.join(dir, 'config.json'), '{not json', 'utf8');
  const store = new ConfigStore(dir);
  const data = store.get();
  assert.deepStrictEqual(data.enabled, DEFAULTS.enabled);
  assert.strictEqual(data.strategy, 'universal');
  assert.strictEqual(data.telegramWs, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('config accepts UTF-8 BOM from hand-edited files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obxodik-config-'));
  const payload = {
    ...DEFAULTS,
    telegramWs: true,
    tgwsPort: 1555,
  };
  fs.writeFileSync(path.join(dir, 'config.json'), `\uFEFF${JSON.stringify(payload)}`, 'utf8');
  const store = new ConfigStore(dir);
  const data = store.get();
  assert.strictEqual(data.telegramWs, true);
  assert.strictEqual(data.tgwsPort, 1555);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('config update persists atomically and merges defaults', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obxodik-config-'));
  const store = new ConfigStore(dir);
  store.update((data) => {
    data.enabled.youtube = false;
    data.strategy = 'fake';
  });
  const reloaded = new ConfigStore(dir).get();
  assert.strictEqual(reloaded.enabled.youtube, false);
  assert.strictEqual(reloaded.enabled.discord, true);
  assert.strictEqual(reloaded.strategy, 'fake');
  fs.rmSync(dir, { recursive: true, force: true });
});
