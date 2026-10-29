'use strict';

const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const crypto = require('node:crypto');
const EventEmitter = require('node:events');

function run(file, args, timeout = 5000) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout }, (error, stdout) => {
      resolve({ error, stdout: String(stdout || '') });
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(500, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

class TgwsProxy extends EventEmitter {
  constructor({ tgwsDir, userDataDir, logFile }) {
    super();
    this.tgwsDir = tgwsDir;
    this.exe = path.join(tgwsDir, 'tgws-core.exe');
    this.userDataDir = userDataDir;
    this.logFile = logFile;
    this.pidFile = path.join(userDataDir, 'tgws.pid');
    this.child = null;
    this.status = 'stopped';
    this.error = null;
    this.port = null;
    this.secret = null;
    this.link = null;
    this.pid = null;
    this.tail = [];
  }

  available() {
    return fs.existsSync(this.exe);
  }

  state() {
    return {
      status: this.status,
      error: this.error,
      port: this.port,
      link: this.link,
      pid: this.pid,
      available: this.available(),
    };
  }

  setStatus(status, error = null) {
    this.status = status;
    this.error = error;
    this.emit('status', this.state());
  }

  logLine(line) {
    const text = String(line).replace(/\r$/, '').trimEnd();
    if (!text) return;
    this.tail.push(text);
    if (this.tail.length > 40) this.tail = this.tail.slice(-40);
    this.emit('log', text);
  }

  removePidFile() {
    try {
      fs.unlinkSync(this.pidFile);
    } catch {
      // already gone
    }
  }

  async cleanupStale() {
    let pid;
    try {
      pid = Number(fs.readFileSync(this.pidFile, 'utf8').trim());
    } catch {
      return;
    }
    if (Number.isInteger(pid) && pid > 0) {
      const listed = await run('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']);
      if (/tgws-core\.exe/i.test(listed.stdout)) {
        this.logLine(`Найден зависший tgws-core.exe (PID ${pid}), завершаю`);
        await run('taskkill', ['/PID', String(pid), '/T', '/F']);
      }
    }
    this.removePidFile();
  }

  async pickPort(preferred) {
    const candidates = [preferred, 1443, 1444, 1445, 1446, 1447, 1448, 1449, 1450, 1451, 1452, 1453, 1454, 1455];
    const seen = new Set();
    for (const candidate of candidates) {
      const port = Number(candidate);
      if (!Number.isInteger(port) || port < 1024 || port > 65535 || seen.has(port)) continue;
      seen.add(port);
      if (await portFree(port)) return port;
    }
    return null;
  }

  async start({ secret, port } = {}) {
    await this.stop();

    if (!this.available()) {
      this.setStatus('error', 'Компонент WS-прокси не найден. Переустановите Obxodik.');
      return this.state();
    }
    if (process.platform !== 'win32') {
      this.setStatus('error', 'WS-прокси доступен только в Windows');
      return this.state();
    }

    const preferred = Number(port) || 1443;
    const chosenPort = await this.pickPort(preferred);
    if (!chosenPort) {
      this.setStatus('error', 'Нет свободного локального порта для WS-прокси');
      return this.state();
    }

    const chosenSecret = /^[0-9a-f]{32}$/.test(String(secret || ''))
      ? String(secret)
      : crypto.randomBytes(16).toString('hex');

    this.port = chosenPort;
    this.secret = chosenSecret;
    this.link = `tg://proxy?server=127.0.0.1&port=${chosenPort}&secret=dd${chosenSecret}`;
    this.error = null;
    this.tail = [];
    this.setStatus('starting');

    const args = [
      '--host', '127.0.0.1',
      '--port', String(chosenPort),
      '--secret', chosenSecret,
      '--log-file', this.logFile,
      '--log-max-mb', '2',
      '--log-backups', '1',
    ];
    this.logLine(`Запуск WS-прокси на 127.0.0.1:${chosenPort}`);

    let child;
    try {
      child = spawn(this.exe, args, {
        cwd: this.tgwsDir,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      this.setStatus('error', `Не удалось запустить WS-прокси: ${error.message}`);
      return this.state();
    }

    this.child = child;
    this.pid = child.pid || null;

    const pipe = (stream, isError) => {
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
      stream.on('error', () => {});
      void isError;
    };
    pipe(child.stdout);
    pipe(child.stderr);

    child.on('error', (error) => {
      if (this.child !== child) return;
      this.logLine(`Ошибка WS-прокси: ${error.message}`);
      this.setStatus('error', error.message);
    });

    child.on('exit', (code, signal) => {
      if (this.child !== child) return;
      this.child = null;
      this.pid = null;
      this.removePidFile();
      this.link = null;
      if (this.status === 'stopping') {
        this.setStatus('stopped');
      } else {
        const last = this.tail.length ? `: ${this.tail[this.tail.length - 1]}` : '';
        const reason = code === 0
          ? `WS-прокси завершился${last}`
          : `WS-прокси завершился с кодом ${code}${signal ? ` (${signal})` : ''}${last}`;
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

    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (this.child !== child) {
        this.setStatus('error', this.error || 'WS-прокси не смог запуститься');
        return this.state();
      }
      if (await canConnect(chosenPort)) {
        this.setStatus('running');
        this.logLine(`WS-прокси готов: ${this.link}`);
        return this.state();
      }
      await delay(250);
    }

    this.logLine('Таймаут ожидания WS-прокси');
    await this.stop();
    this.setStatus('error', 'WS-прокси не начал принимать подключения');
    return this.state();
  }

  async stop() {
    const child = this.child;
    const pid = this.pid;
    this.child = null;
    this.pid = null;
    this.link = null;

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

    // Kill the tree first: a PyInstaller build may have a child process,
    // and killing only the launcher would leave the proxy running.
    if (pid) {
      await run('taskkill', ['/PID', String(pid), '/T', '/F']);
    }
    try {
      child.kill();
    } catch {
      // ignore
    }
    await exited;

    if (pid) {
      const listed = await run('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']);
      if (/tgws-core\.exe/i.test(listed.stdout)) {
        await run('taskkill', ['/PID', String(pid), '/T', '/F']);
      }
    }

    this.removePidFile();
    this.logLine('WS-прокси остановлен');
    this.setStatus('stopped');
  }

  async restart(options) {
    await this.stop();
    return this.start(options);
  }
}

module.exports = { TgwsProxy };
