'use strict';

const { spawn, execFile, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const EventEmitter = require('node:events');
const { buildArgs } = require('./profiles');

function run(file, args, timeout = 5000) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout }, (error, stdout, stderr) => {
      resolve({ error, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

class Engine extends EventEmitter {
  constructor({ zapretDir, userDataDir, logFile }) {
    super();
    this.zapretDir = zapretDir;
    this.binDir = path.join(zapretDir, 'bin');
    this.listsDir = path.join(zapretDir, 'lists');
    this.exe = path.join(this.binDir, 'winws.exe');
    this.userDataDir = userDataDir;
    this.pidFile = path.join(userDataDir, 'engine.pid');
    this.logFile = logFile;
    this.child = null;
    this.status = 'stopped';
    this.error = null;
    this.lastArgs = [];
    this.pid = null;
    this._admin = null;
  }

  isAdmin() {
    if (process.platform !== 'win32') return false;
    if (this._admin === null) {
      // fltmc does not depend on the Server service, unlike `net session`.
      const filterManager = spawnSync('fltmc', [], { windowsHide: true, stdio: 'ignore' });
      this._admin = filterManager.status === 0;
      if (!this._admin) {
        const session = spawnSync('net', ['session'], { windowsHide: true, stdio: 'ignore' });
        this._admin = session.status === 0;
      }
    }
    return this._admin;
  }

  async cleanupStale() {
    let pid;
    try {
      pid = Number(fs.readFileSync(this.pidFile, 'utf8').trim());
    } catch {
      return;
    }
    if (!Number.isInteger(pid) || pid <= 0) {
      this.removePidFile();
      return;
    }

    const listed = await run('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']);
    if (/winws\.exe/i.test(listed.stdout)) {
      this.logLine(`Найден зависший процесс winws.exe (PID ${pid}), завершаю`);
      await run('taskkill', ['/PID', String(pid), '/T', '/F']);
    }
    this.removePidFile();
  }

  removePidFile() {
    try {
      fs.unlinkSync(this.pidFile);
    } catch {
      // already gone
    }
  }

  logLine(line) {
    const text = String(line).replace(/\r$/, '');
    if (!text) return;
    const stamp = new Date().toLocaleTimeString('ru-RU', { hour12: false });
    const entry = `[${stamp}] ${text}`;
    this.emit('log', entry);
    try {
      fs.appendFileSync(this.logFile, `${entry}\n`, 'utf8');
      const stat = fs.statSync(this.logFile);
      if (stat.size > 1.5 * 1024 * 1024) {
        const content = fs.readFileSync(this.logFile, 'utf8').split('\n').slice(-4000).join('\n');
        fs.writeFileSync(this.logFile, content, 'utf8');
      }
    } catch {
      // logging must never break the engine
    }
  }

  setStatus(status, error = null) {
    this.status = status;
    this.error = error;
    this.emit('status', this.state());
  }

  state() {
    return {
      status: this.status,
      error: this.error,
      pid: this.pid,
      args: this.lastArgs,
    };
  }

  async start(config, { force = false } = {}) {
    const wanted = ['youtube', 'discord', 'telegram'].some((id) => config.enabled[id]);
    if (!wanted) {
      await this.stop();
      return this.state();
    }

    if (!force && this.child && this.status === 'running') {
      return this.state();
    }

    await this.stop();
    this.error = null;
    this.setStatus('starting');

    if (process.platform !== 'win32') {
      this.setStatus('error', 'Obxodik поддерживает только Windows');
      return this.state();
    }
    if (!fs.existsSync(this.exe)) {
      this.setStatus('error', `Не найден движок обхода: ${this.exe}`);
      return this.state();
    }
    if (!this.isAdmin()) {
      this.setStatus('error', 'Нужны права администратора: перезапустите Obxodik от имени администратора');
      return this.state();
    }

    const args = buildArgs({
      enabled: config.enabled,
      strategy: config.strategy,
      ipsetMode: config.ipsetMode,
      binDir: this.binDir,
      listsDir: this.listsDir,
    });
    this.lastArgs = args;
    this.logLine(`Рабочая папка: ${this.binDir}`);
    this.logLine(`Запуск: "${this.exe}" ${args.map((item) => (item.includes(' ') ? JSON.stringify(item) : item)).join(' ')}`);

    let child;
    try {
      child = spawn(this.exe, args, {
        cwd: this.binDir,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      this.setStatus('error', `Не удалось запустить winws.exe: ${error.message}`);
      return this.state();
    }

    this.child = child;
    this.pid = child.pid || null;

    const pipe = (stream) => {
      stream.setEncoding('utf8');
      let buffer = '';
      stream.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const line of lines) this.logLine(line);
      });
      stream.on('end', () => {
        if (buffer.trim()) this.logLine(buffer);
      });
    };
    pipe(child.stdout);
    pipe(child.stderr);

    child.on('error', (error) => {
      if (this.child !== child) return;
      this.logLine(`Ошибка процесса: ${error.message}`);
      this.child = null;
      this.pid = null;
      this.removePidFile();
      this.setStatus('error', error.message);
    });

    child.on('exit', (code, signal) => {
      if (this.child !== child) return;
      this.child = null;
      this.pid = null;
      this.removePidFile();
      if (this.status === 'stopping') {
        this.setStatus('stopped');
      } else {
        const reason = code === 0
          ? 'Движок завершил работу'
          : `Движок завершился с кодом ${code}${signal ? ` (${signal})` : ''}`;
        this.logLine(reason);
        this.setStatus('error', reason);
      }
    });

    if (this.pid) {
      try {
        fs.writeFileSync(this.pidFile, String(this.pid), 'utf8');
      } catch {
        // non-critical
      }
    }

    // winws reports driver problems in the first second. Give it that time
    // so the UI does not claim "running" for a dead process.
    await new Promise((resolve) => setTimeout(resolve, 700));
    if (this.child === child && this.status !== 'error' && child.pid && !child.killed) {
      this.setStatus('running');
      this.logLine('Обход запущен');
    } else if (!this.error && this.status !== 'error') {
      this.setStatus('error', 'Движок не смог запуститься. Откройте логи.');
    }

    return this.state();
  }

  async stop() {
    const child = this.child;
    this.child = null;
    const pid = this.pid;
    this.pid = null;
    if (!child && !pid) {
      this.removePidFile();
      if (this.status !== 'stopped') this.setStatus('stopped');
      return;
    }

    this.setStatus('stopping');
    const exited = new Promise((resolve) => {
      if (!child) return resolve();
      const timer = setTimeout(resolve, 1200);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });

    try {
      child.kill();
    } catch {
      // ignore
    }
    await exited;

    if (pid) {
      const listed = await run('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']);
      if (/winws\.exe/i.test(listed.stdout)) {
        await run('taskkill', ['/PID', String(pid), '/T', '/F']);
      }
    }

    this.removePidFile();
    this.logLine('Обход остановлен');
    this.setStatus('stopped');
  }
}

module.exports = { Engine };
