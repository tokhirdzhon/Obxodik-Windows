'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { buildArgs, STRATEGY_IDS } = require('../electron/profiles');

const root = path.join(__dirname, '..', 'resources', 'zapret');
const binDir = path.join(root, 'bin');
const listsDir = path.join(root, 'lists');
const off = { youtube: false, discord: false, telegram: false };

function args(enabled, strategy = 'universal', ipsetMode = 'loaded') {
  return buildArgs({ enabled, strategy, ipsetMode, binDir, listsDir });
}

function profilesCount(argv) {
  return argv.filter((item) => item === '--new').length + 1;
}

test('no profiles when everything is disabled', () => {
  const argv = args(off);
  assert.strictEqual(profilesCount(argv), 1);
  assert.ok(!argv.includes('--new'));
  assert.ok(argv.some((item) => item.startsWith('--wf-tcp=')));
});

test('youtube only enables youtube hostlists plus the IP layer', () => {
  const argv = args({ ...off, youtube: true });
  assert.strictEqual(profilesCount(argv), 5);
  const joined = argv.join(' ');
  assert.match(joined, /list-youtube\.txt/);
  assert.doesNotMatch(joined, /list-discord\.txt/);
  assert.doesNotMatch(joined, /list-telegram\.txt/);
  assert.match(joined, /fake-quic=/);
});

test('discord only includes voice and discord profiles plus the IP layer', () => {
  const argv = args({ ...off, discord: true });
  assert.strictEqual(profilesCount(argv), 6);
  const joined = argv.join(' ');
  assert.match(joined, /list-discord\.txt/);
  assert.match(joined, /filter-l7=discord,stun/);
  assert.match(joined, /19294-19344,50000-50100/);
  assert.doesNotMatch(joined, /list-youtube\.txt/);
});

test('telegram uses separate hostlist and official ipset profiles', () => {
  const argv = args({ ...off, telegram: true });
  assert.strictEqual(profilesCount(argv), 6);
  const joined = argv.join(' ');
  assert.match(joined, /filter-tcp=443 --ipset=.*ipset-telegram\.txt/);
  assert.match(joined, /filter-tcp=443 --hostlist=.*list-telegram\.txt/);
  assert.match(joined, /dpi-desync-any-protocol=1/);
  assert.match(joined, /dpi-desync=multisplit/);
});

test('all services together do not leave a dangling --new', () => {
  const argv = args({ youtube: true, discord: true, telegram: true });
  assert.strictEqual(profilesCount(argv), 13);
  assert.notStrictEqual(argv[argv.length - 1], '--new');
  assert.strictEqual(argv.filter((item) => item === '--new').length, 12);
});

test('every strategy produces a different TLS profile', () => {
  const signatures = new Set();
  for (const strategy of STRATEGY_IDS) {
    const argv = args({ ...off, youtube: true }, strategy);
    signatures.add(argv.join(' '));
  }
  assert.strictEqual(signatures.size, STRATEGY_IDS.length);
});

test('unknown strategy falls back to universal', () => {
  const argv = args({ ...off, youtube: true }, 'nope');
  assert.match(argv.join(' '), /multisplit/);
});

test('argv elements never contain merged filter options', () => {
  for (const strategy of STRATEGY_IDS) {
    const argv = args({ youtube: true, discord: true, telegram: true }, strategy);
    for (const item of argv) {
      assert.ok(!/^--filter-.*\s--/.test(item), `merged filter argument: ${item}`);
      assert.ok(!/^--filter-[a-z0-9-]+=\S+\s/.test(item), `filter value contains space: ${item}`);
    }
  }
});

test('filter, hostlist and ipset values are separate arguments', () => {
  const argv = args({ youtube: true, discord: true, telegram: true });
  for (const item of argv) {
    if (item.startsWith('--filter-')) {
      assert.match(item, /^--filter-(tcp|udp|l7|l3)=\S+$/, `bad filter argument: ${item}`);
    }
    if (item.startsWith('--hostlist=') || item.startsWith('--hostlist-exclude=') ||
        item.startsWith('--ipset=') || item.startsWith('--ipset-exclude=')) {
      assert.ok(!item.includes(' --'), `merged list argument: ${item}`);
    }
  }
});

test('Telegram ipset profiles do not require a hostname', () => {
  const argv = args({ ...off, telegram: true });
  const profiles = [];
  let current = [];
  for (const item of argv) {
    if (item === '--new') {
      profiles.push(current);
      current = [];
    } else {
      current.push(item);
    }
  }
  profiles.push(current);
  const ipsetProfiles = profiles.filter((profile) =>
    profile.some((item) => item.includes('ipset-telegram.txt')));
  assert.strictEqual(ipsetProfiles.length, 2);
  for (const profile of ipsetProfiles) {
    assert.ok(!profile.some((item) => item.startsWith('--hostlist-exclude=')),
      'ipset profile must not contain hostlist-exclude');
  }
});

test('IPSet loaded mode uses the global ipset-all list', () => {
  const argv = args({ youtube: true, discord: true, telegram: true }, 'universal', 'loaded');
  assert.ok(argv.some((item) => item.startsWith('--ipset=') && item.endsWith('/ipset-all.txt')));
  assert.ok(!argv.some((item) => item.startsWith('--ipset-ip=')));
});

test('IPSet any mode matches all IPv4 and IPv6 addresses', () => {
  const argv = args({ youtube: true, discord: true, telegram: true }, 'universal', 'any');
  assert.ok(argv.includes('--ipset-ip=0.0.0.0/0,::/0'));
  assert.ok(!argv.some((item) => item.startsWith('--ipset=') && item.endsWith('/ipset-all.txt')));
});

test('IPSet none mode disables every IP-based profile', () => {
  const argv = args({ youtube: true, discord: true, telegram: true }, 'universal', 'none');
  assert.strictEqual(profilesCount(argv), 9);
  assert.ok(!argv.some((item) => item.startsWith('--ipset=')));
  assert.ok(!argv.some((item) => item.startsWith('--ipset-ip=')));
  assert.ok(!argv.some((item) => item.startsWith('--ipset-exclude=')));
  assert.ok(!argv.some((item) => item.includes('ipset-telegram.txt')));
});

test('fake_auto uses the winws random-tls marker without cmd escaping', () => {
  const argv = args({ ...off, youtube: true }, 'fake_auto');
  assert.ok(argv.includes('--dpi-desync-fake-tls=!'));
  assert.ok(!argv.some((item) => item.includes('^!')));
});

test('all file arguments are absolute and exist', () => {
  for (const strategy of STRATEGY_IDS) {
    const argv = args({ youtube: true, discord: true, telegram: true }, strategy);
    for (const item of argv) {
      const match = item.match(/^--(?:hostlist|hostlist-exclude|ipset|ipset-exclude|dpi-desync-fake-[a-z-]+|dpi-desync-split-seqovl-pattern)=(.*)$/);
      if (!match) continue;
      if (!/\.(bin|txt)$/.test(match[1])) continue;
      assert.ok(path.isAbsolute(match[1]), `path must be absolute: ${match[1]}`);
      assert.ok(fs.existsSync(match[1]), `missing file: ${match[1]}`);
    }
  }
});

test('paths with spaces remain a single argument', () => {
  const fakeBin = path.join('C:\\Program Files\\Obxodik', 'resources', 'zapret', 'bin');
  const fakeLists = path.join('C:\\Program Files\\Obxodik', 'resources', 'zapret', 'lists');
  const argv = buildArgs({
    enabled: { youtube: true, discord: true, telegram: true },
    strategy: 'universal',
    binDir: fakeBin,
    listsDir: fakeLists,
  });
  const hostlist = argv.find((item) => item.startsWith('--hostlist='));
  assert.ok(hostlist.includes('Program Files'), 'space path was split');
  assert.match(hostlist, /^--hostlist=C:\/Program Files\/Obxodik\/.*\/list-youtube\.txt$/);
  assert.ok(!argv.includes('Files/Obxodik/resources/zapret/lists/list-youtube.txt'));
});

test('bundle contains the engine, driver and fakes', () => {
  for (const file of [
    'bin/winws.exe',
    'bin/WinDivert.dll',
    'bin/WinDivert64.sys',
    'bin/cygwin1.dll',
    'bin/ACTIVE_DISCORD_UDP.bin',
    'bin/tls_clienthello_www_google_com.bin',
    'bin/quic_initial_www_google_com.bin',
    'lists/ipset-telegram.txt',
    'lists/ipset-all.txt',
  ]) {
    assert.ok(fs.existsSync(path.join(root, file)), `missing ${file}`);
  }
});
