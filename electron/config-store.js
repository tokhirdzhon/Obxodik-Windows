'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = {
  version: 1,
  enabled: {
    youtube: true,
    discord: true,
    telegram: true,
  },
  strategy: 'universal',
  ipsetMode: 'loaded',
  autostart: false,
  telegramWs: false,
  tgwsSecret: '',
  tgwsPort: 1443,
  telegramProxy: '',
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class ConfigStore {
  constructor(userDataDir) {
    this.file = path.join(userDataDir, 'config.json');
    this.data = this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8').replace(/^\uFEFF/, '');
      const parsed = JSON.parse(raw);
      return {
        ...clone(DEFAULTS),
        ...parsed,
        enabled: { ...DEFAULTS.enabled, ...(parsed.enabled || {}) },
      };
    } catch {
      return clone(DEFAULTS);
    }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch {
      // A read-only profile should not crash the bypass engine.
    }
  }

  get() {
    return clone(this.data);
  }

  update(mutator) {
    mutator(this.data);
    this.save();
    return this.get();
  }
}

module.exports = { ConfigStore, DEFAULTS };
