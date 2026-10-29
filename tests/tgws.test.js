'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { TgwsProxy } = require('../electron/tgws');

const tgwsDir = path.join(__dirname, '..', 'resources', 'tgws');

test('WS proxy starts on loopback, exposes a dd secret and stops cleanly', {
  skip: process.platform !== 'win32',
  timeout: 40000,
}, async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obxodik-tgws-test-'));
  const proxy = new TgwsProxy({
    tgwsDir,
    userDataDir,
    logFile: path.join(userDataDir, 'tgws.log'),
  });
  const port = 20000 + Math.floor(Math.random() * 10000);
  try {
    await proxy.cleanupStale();
    const state = await proxy.start({ port, secret: 'a'.repeat(32) });
    assert.strictEqual(state.status, 'running', state.error || 'proxy failed to start');
    assert.strictEqual(state.port, port);
    assert.match(state.link, /^tg:\/\/proxy\?server=127\.0\.0\.1&port=\d+&secret=dda{32}$/);
    assert.ok(fs.existsSync(path.join(userDataDir, 'tgws.pid')));
  } finally {
    await proxy.stop();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
  assert.strictEqual(proxy.status, 'stopped');
  assert.strictEqual(proxy.link, null);
  assert.strictEqual(proxy.pid, null);
});

test('WS proxy reports a missing component instead of throwing', {
  skip: process.platform !== 'win32',
}, async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obxodik-tgws-miss-'));
  const proxy = new TgwsProxy({
    tgwsDir: path.join(userDataDir, 'missing'),
    userDataDir,
    logFile: path.join(userDataDir, 'tgws.log'),
  });
  const state = await proxy.start({ port: 21111 });
  assert.strictEqual(state.status, 'error');
  assert.match(state.error, /не найден/i);
  assert.strictEqual(state.available, false);
  fs.rmSync(userDataDir, { recursive: true, force: true });
});
