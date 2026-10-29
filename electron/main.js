'use strict';

const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  Tray,
  Menu,
  nativeImage,
  Notification,
  powerMonitor,
  dialog,
  clipboard,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const https = require('node:https');
const dns = require('node:dns');
const { spawn, execFile } = require('node:child_process');

const { ConfigStore } = require('./config-store');
const { Engine } = require('./engine');
const { TgwsProxy } = require('./tgws');
const { STRATEGIES, STRATEGY_IDS, IPSET_MODES, IPSET_MODE_IDS } = require('./profiles');

const APP_ID = 'ru.obxodik.app';
const TASK_NAME = 'Obxodik';
const LOG_LIMIT = 400;

app.setAppUserModelId(APP_ID);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

const userDataDir = app.getPath('userData');
const logFile = path.join(userDataDir, 'obxodik.log');
fs.mkdirSync(userDataDir, { recursive: true });

const zapretDir = app.isPackaged
  ? path.join(process.resourcesPath, 'zapret')
  : path.join(__dirname, '..', 'resources', 'zapret');
const tgwsDir = app.isPackaged
  ? path.join(process.resourcesPath, 'tgws')
  : path.join(__dirname, '..', 'resources', 'tgws');
const iconPath = app.isPackaged
  ? path.join(process.resourcesPath, 'icon.ico')
  : path.join(__dirname, '..', 'resources', 'icon.ico');

const config = new ConfigStore(userDataDir);
const engine = new Engine({ zapretDir, userDataDir, logFile });
const tgws = new TgwsProxy({
  tgwsDir,
  userDataDir,
  logFile: path.join(userDataDir, 'tgws.log'),
});

let mainWindow = null;
let tray = null;
let quitting = false;
let trayHintShown = false;
let logTail = [];
let lastTest = null;
let busy = Promise.resolve();

function enqueue(task) {
  const run = busy.then(task, task);
  busy = run.catch(() => {});
  return run;
}

function pushLog(entry, { persist = false } = {}) {
  logTail.push(entry);
  if (logTail.length > LOG_LIMIT) logTail = logTail.slice(-LOG_LIMIT);
  if (persist) {
    try {
      fs.appendFileSync(logFile, `${entry}\n`, 'utf8');
      const stat = fs.statSync(logFile);
      if (stat.size > 1.5 * 1024 * 1024) {
        const content = fs.readFileSync(logFile, 'utf8').split('\n').slice(-4000).join('\n');
        fs.writeFileSync(logFile, content, 'utf8');
      }
    } catch {
      // logging must never break the app
    }
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('obxodik:log', entry);
  }
}

engine.on('log', pushLog);
engine.on('status', () => broadcast());
tgws.on('log', (line) => {
  const stamp = new Date().toLocaleTimeString('ru-RU', { hour12: false });
  const safe = String(line)
    .replace(/secret=dd[0-9a-f]{32}/gi, 'secret=dd<скрыт>')
    .replace(/Secret:\s*[0-9a-f]{32}/gi, 'Secret: <скрыт>');
  pushLog(`[${stamp}] [ws] ${safe}`, { persist: true });
});
tgws.on('status', () => broadcast());

function snapshot() {
  const cfg = config.get();
  return {
    version: app.getVersion(),
    isAdmin: engine.isAdmin(),
    packaged: app.isPackaged,
    platform: process.platform,
    enabled: cfg.enabled,
    strategy: cfg.strategy,
    ipsetMode: cfg.ipsetMode,
    autostart: cfg.autostart,
    telegramWs: cfg.telegramWs,
    telegramProxy: cfg.telegramProxy,
    engine: engine.state(),
    tgws: tgws.state(),
    strategies: STRATEGIES,
    ipsetModes: IPSET_MODES,
    logs: logTail.slice(-200),
    lastTest,
  };
}

function broadcast() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('obxodik:state', snapshot());
  refreshTrayMenu();
}

async function startEngine() {
  return enqueue(async () => {
    await engine.start(config.get(), { force: true });
    broadcast();
    return snapshot();
  });
}

async function restartEngine() {
  return enqueue(async () => {
    const cfg = config.get();
    await engine.stop();
    const wanted = ['youtube', 'discord', 'telegram'].some((id) => cfg.enabled[id]);
    if (wanted) await engine.start(cfg, { force: true });
    broadcast();
    return snapshot();
  });
}

async function stopEngine() {
  return enqueue(async () => {
    await engine.stop();
    broadcast();
    return snapshot();
  });
}

async function startTgwsNow() {
  const cfg = config.get();
  if (!cfg.enabled.telegram || !cfg.telegramWs) return tgws.state();
  const state = await tgws.start({ secret: cfg.tgwsSecret, port: cfg.tgwsPort });
  if (state.status === 'running') {
    const updates = {};
    if (tgws.secret && tgws.secret !== cfg.tgwsSecret) updates.tgwsSecret = tgws.secret;
    if (tgws.port && tgws.port !== cfg.tgwsPort) updates.tgwsPort = tgws.port;
    if (Object.keys(updates).length) {
      config.update((data) => Object.assign(data, updates));
    }
  }
  broadcast();
  return tgws.state();
}

async function stopTgwsNow() {
  await tgws.stop();
  broadcast();
  return tgws.state();
}

async function startTgws() {
  return enqueue(() => startTgwsNow());
}

function run(file, args, timeout = 8000) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout }, (error, stdout, stderr) => {
      resolve({ error, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

async function autostartExists() {
  if (process.platform !== 'win32') return false;
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$task = Get-ScheduledTask -TaskName '${TASK_NAME}' -ErrorAction Stop`,
    "if ($task.State -eq 'Disabled') { throw 'task disabled' }",
  ].join('\n');
  const result = await runPowerShell(script, 15000);
  return !result.error;
}

function runPowerShell(script, timeout = 20000) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return run('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded,
  ], timeout);
}

async function setAutostart(enabled) {
  if (process.platform !== 'win32' || !app.isPackaged) {
    return { ok: false, error: 'Автозапуск доступен в установленной версии Obxodik' };
  }
  const escapedExe = process.execPath.replace(/'/g, "''");
  const script = enabled
    ? [
        "$ErrorActionPreference = 'Stop'",
        '$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name',
        `$action = New-ScheduledTaskAction -Execute '${escapedExe}' -Argument '--silent'`,
        '$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId',
        '$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Highest',
        '$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable',
        `Register-ScheduledTask -TaskName '${TASK_NAME}' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null`,
      ].join('\n')
    : [
        "$ErrorActionPreference = 'Stop'",
        `Unregister-ScheduledTask -TaskName '${TASK_NAME}' -Confirm:$false`,
      ].join('\n');
  const result = await runPowerShell(script, 25000);
  if (result.error) {
    const detail = (result.stderr || result.stdout || result.error.message).trim();
    if (!enabled && /not found|не найдена|No MSFT_ScheduledTask|cannot find|не существует/i.test(detail)) {
      config.update((data) => {
        data.autostart = false;
      });
      broadcast();
      return { ok: true, state: snapshot() };
    }
    return { ok: false, error: detail || 'Не удалось изменить задачу автозапуска' };
  }
  config.update((data) => {
    data.autostart = enabled;
  });
  broadcast();
  return { ok: true, state: snapshot() };
}

function createWindow({ show = true } = {}) {
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 900,
    minHeight: 640,
    show: false,
    backgroundColor: '#070b12',
    title: 'Obxodik',
    icon: iconPath,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#070b12',
      symbolColor: '#c9d6ea',
      height: 44,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'ui', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    if (show) mainWindow.show();
  });

  if (!app.isPackaged && process.env.OBXODIK_SHOT) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const image = await mainWindow.webContents.capturePage();
          fs.writeFileSync(process.env.OBXODIK_SHOT, image.toPNG());
        } finally {
          await Promise.allSettled([engine.stop(), tgws.stop()]);
          app.exit(0);
        }
      }, Number(process.env.OBXODIK_SHOT_DELAY || 1800));
    });
  }

  mainWindow.on('close', (event) => {
    if (quitting) return;
    if (!tray) {
      app.quit();
      return;
    }
    event.preventDefault();
    mainWindow.hide();
    if (!trayHintShown && Notification.isSupported()) {
      trayHintShown = true;
      new Notification({
        title: 'Obxodik работает',
        body: 'Приложение свёрнуто в трей. Обход продолжает работать.',
        icon: iconPath,
      }).show();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openSafeExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  return mainWindow;
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function refreshTrayMenu() {
  if (!tray) return;
  const running = engine.status === 'running' || engine.status === 'starting';
  tray.setToolTip(`Obxodik — ${running ? 'обход включён' : 'обход выключен'}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: running ? 'Обход включён' : 'Обход выключен', enabled: false },
    { type: 'separator' },
    { label: 'Открыть Obxodik', click: showWindow },
    {
      label: running ? 'Выключить обход' : 'Включить обход',
      click: () => {
        const cfg = config.get();
        const any = ['youtube', 'discord', 'telegram'].some((id) => cfg.enabled[id]);
        if (running) {
          stopEngine();
          enqueue(() => stopTgwsNow());
        } else if (any) {
          startEngine().then(() => {
            const fresh = config.get();
            if (fresh.telegramWs && fresh.enabled.telegram) startTgws();
          });
        } else {
          config.update((data) => {
            data.enabled = { youtube: true, discord: true, telegram: true };
          });
          startEngine().then(() => {
            const fresh = config.get();
            if (fresh.telegramWs) startTgws();
          });
        }
      },
    },
    { type: 'separator' },
    { label: 'Выход', click: () => requestQuit() },
  ]));
}

async function requestQuit() {
  if (quitting) return;
  const options = {
    type: 'question',
    buttons: ['Выйти', 'Отмена'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: 'Obxodik',
    message: 'Выйти из Obxodik?',
    detail: tgws.status === 'running' || tgws.status === 'starting'
      ? 'Обход будет выключен. В настройках Telegram останется локальный прокси 127.0.0.1 — отключите его в Telegram или запустите Obxodik снова, иначе мессенджер может не подключаться.'
      : 'Обход будет выключен, пока вы снова не запустите приложение.',
  };
  const { response } = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options);
  if (response === 0) app.quit();
}

function createTray() {
  try {
    let image = nativeImage.createFromPath(iconPath);
    if (!image.isEmpty()) image = image.resize({ width: 16, height: 16 });
    tray = new Tray(image);
    tray.on('click', showWindow);
    tray.on('double-click', showWindow);
    refreshTrayMenu();
  } catch {
    tray = null;
  }
}

async function openSafeExternal(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl));
  } catch {
    return { ok: false, error: 'Некорректная ссылка' };
  }
  const allowedHosts = new Set([
    'github.com',
    't.me',
    'telegram.org',
    'core.telegram.org',
    'desktop.telegram.org',
  ]);
  if (url.protocol === 'tg:') {
    if (!/^tg:\/\/(proxy|socks)\?/i.test(url.toString())) {
      return { ok: false, error: 'Ссылка не разрешена' };
    }
  } else if (!(url.protocol === 'https:' && allowedHosts.has(url.hostname))) {
    return { ok: false, error: 'Ссылка не разрешена' };
  }
  try {
    await shell.openExternal(url.toString());
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function telegramProtocolRegistered() {
  if (process.platform !== 'win32') return false;
  const result = await run('reg', ['query', 'HKEY_CLASSES_ROOT\\tg\\shell\\open\\command'], 5000);
  return !result.error;
}

function normalizeTelegramProxy(input) {
  const value = String(input || '').trim();
  if (!value) return { ok: false, error: 'Вставьте ссылку на прокси' };

  if (value.startsWith('tg://proxy?') || value.startsWith('https://t.me/proxy?')) {
    return { ok: true, url: value };
  }
  if (value.startsWith('https://t.me/socks?')) {
    return { ok: true, url: value };
  }

  const parts = value.split(':');
  if (parts.length === 3) {
    const [server, port, secret] = parts;
    if (!/^[a-zA-Z0-9.-]+$/.test(server)) {
      return { ok: false, error: 'Некорректный адрес сервера' };
    }
    if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
      return { ok: false, error: 'Некорректный порт' };
    }
    if (!/^[a-zA-Z0-9_\-+/=]+$/.test(secret)) {
      return { ok: false, error: 'Некорректный секрет прокси' };
    }
    return {
      ok: true,
      url: `tg://proxy?server=${encodeURIComponent(server)}&port=${port}&secret=${encodeURIComponent(secret)}`,
    };
  }

  return {
    ok: false,
    error: 'Поддерживается ссылка tg://proxy?…, https://t.me/proxy?… или формат host:port:secret',
  };
}

function checkUrl(id, label, url) {
  return new Promise((resolve) => {
    const host = new URL(url).hostname;
    const started = Date.now();
    let settled = false;
    const finish = (data) => {
      if (settled) return;
      settled = true;
      resolve({ id, label, url, elapsed: Date.now() - started, ...data });
    };

    dns.promises.lookup(host)
      .then((address) => {
        const request = https.get(url, {
          headers: {
            'User-Agent': `Obxodik/${app.getVersion()} connectivity-check`,
            Accept: '*/*',
            'Cache-Control': 'no-cache',
          },
          timeout: 9000,
        }, (response) => {
          response.resume();
          finish({
            ok: true,
            status: response.statusCode,
            dns: address.address,
          });
        });
        request.on('timeout', () => {
          request.destroy(new Error('Таймаут соединения'));
        });
        request.on('error', (error) => {
          finish({ ok: false, dns: address.address, error: error.message });
        });
      })
      .catch((error) => {
        finish({ ok: false, error: `DNS: ${error.message}` });
      });
  });
}

async function runConnectivityTest() {
  const results = await Promise.all([
    checkUrl('youtube', 'YouTube', 'https://www.youtube.com/generate_204'),
    checkUrl('discord', 'Discord', 'https://discord.com/api/v9/gateway'),
    checkUrl('telegram', 'Telegram', 'https://telegram.org/'),
  ]);
  lastTest = { at: Date.now(), results };
  broadcast();
  return lastTest;
}

function registerIpc() {
  ipcMain.handle('obxodik:get-state', () => snapshot());

  ipcMain.handle('obxodik:set-service', (_event, { id, enabled }) => enqueue(async () => {
    if (!['youtube', 'discord', 'telegram'].includes(id)) {
      return { ok: false, error: 'Неизвестное приложение' };
    }
    config.update((data) => {
      data.enabled[id] = Boolean(enabled);
    });
    const cfg = config.get();
    const any = ['youtube', 'discord', 'telegram'].some((service) => cfg.enabled[service]);
    if (!any) {
      await engine.stop();
    } else {
      await engine.stop();
      await engine.start(cfg, { force: true });
    }
    if (id === 'telegram') {
      if (cfg.enabled.telegram && cfg.telegramWs) {
        await startTgwsNow();
      } else {
        await stopTgwsNow();
      }
    }
    broadcast();
    return { ok: true, state: snapshot() };
  }));

  ipcMain.handle('obxodik:set-all', (_event, { enabled }) => enqueue(async () => {
    config.update((data) => {
      data.enabled = {
        youtube: Boolean(enabled),
        discord: Boolean(enabled),
        telegram: Boolean(enabled),
      };
    });
    const cfg = config.get();
    if (enabled) {
      await engine.stop();
      await engine.start(cfg, { force: true });
      if (cfg.telegramWs) await startTgwsNow();
    } else {
      await engine.stop();
      await stopTgwsNow();
    }
    broadcast();
    return { ok: true, state: snapshot() };
  }));

  ipcMain.handle('obxodik:restart', () => enqueue(async () => {
    const cfg = config.get();
    await engine.stop();
    if (['youtube', 'discord', 'telegram'].some((id) => cfg.enabled[id])) {
      await engine.start(cfg, { force: true });
    }
    if (cfg.enabled.telegram && cfg.telegramWs) {
      await startTgwsNow();
    } else {
      await stopTgwsNow();
    }
    broadcast();
    return { ok: true, state: snapshot() };
  }));

  ipcMain.handle('obxodik:set-telegram-ws', (_event, { enabled }) => enqueue(async () => {
    const cfg = config.get();
    if (enabled && !cfg.enabled.telegram) {
      return { ok: false, error: 'Сначала включите Telegram' };
    }
    config.update((data) => {
      data.telegramWs = Boolean(enabled);
    });
    if (!enabled) {
      await stopTgwsNow();
      return {
        ok: true,
        state: snapshot(),
        message: 'WS-прокси выключен. Если Telegram не подключается, отключите прокси в настройках Telegram.',
      };
    }
    const state = await startTgwsNow();
    if (state.status !== 'running') {
      return {
        ok: false,
        error: state.error || 'WS-прокси не запустился. Попробуйте ещё раз.',
        state: snapshot(),
      };
    }
    let opened = false;
    if (await telegramProtocolRegistered()) {
      try {
        await shell.openExternal(state.link);
        opened = true;
      } catch {
        opened = false;
      }
    }
    return {
      ok: true,
      state: snapshot(),
      opened,
      message: opened
        ? 'WS-прокси запущен. Подтвердите подключение в Telegram.'
        : 'WS-прокси запущен. Нажмите «Подключить в Telegram» и подтвердите прокси в приложении.',
    };
  }));

  ipcMain.handle('obxodik:tgws-connect', async () => {
    const state = tgws.state();
    if (state.status !== 'running' || !state.link) {
      return { ok: false, error: 'WS-прокси не запущен' };
    }
    try {
      await shell.openExternal(state.link);
      return { ok: true, message: 'Ссылка передана в Telegram. Подтвердите прокси в приложении.' };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('obxodik:tgws-copy', () => {
    const state = tgws.state();
    if (!state.link) return { ok: false, error: 'Ссылка недоступна' };
    clipboard.writeText(state.link);
    return { ok: true, message: 'Ссылка на WS-прокси скопирована' };
  });

  ipcMain.handle('obxodik:set-strategy', (_event, { strategy }) => enqueue(async () => {
    if (!STRATEGY_IDS.includes(strategy)) {
      return { ok: false, error: 'Неизвестная стратегия' };
    }
    config.update((data) => {
      data.strategy = strategy;
    });
    if (engine.status === 'running' || engine.status === 'error') {
      const cfg = config.get();
      await engine.stop();
      if (['youtube', 'discord', 'telegram'].some((id) => cfg.enabled[id])) {
        await engine.start(cfg, { force: true });
      }
    }
    broadcast();
    return { ok: true, state: snapshot() };
  }));

  ipcMain.handle('obxodik:set-ipset-mode', (_event, { mode }) => enqueue(async () => {
    if (!IPSET_MODE_IDS.includes(mode)) {
      return { ok: false, error: 'Неизвестный режим IPSet' };
    }
    config.update((data) => {
      data.ipsetMode = mode;
    });
    if (engine.status === 'running' || engine.status === 'error') {
      const cfg = config.get();
      await engine.stop();
      if (['youtube', 'discord', 'telegram'].some((id) => cfg.enabled[id])) {
        await engine.start(cfg, { force: true });
      }
    }
    broadcast();
    return { ok: true, state: snapshot() };
  }));

  ipcMain.handle('obxodik:set-autostart', async (_event, { enabled }) => {
    return setAutostart(Boolean(enabled));
  });

  ipcMain.handle('obxodik:test', async () => {
    try {
      const result = await runConnectivityTest();
      return { ok: true, test: result };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('obxodik:telegram-proxy', async (_event, { value }) => {
    const normalized = normalizeTelegramProxy(value);
    if (!normalized.ok) return normalized;
    config.update((data) => {
      data.telegramProxy = String(value || '').trim();
    });
    try {
      await shell.openExternal(normalized.url);
      return { ok: true, message: 'Ссылка передана в Telegram. Подтвердите подключение прокси в приложении.' };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('obxodik:open-external', (_event, { url }) => openSafeExternal(url));

  ipcMain.handle('obxodik:open-logs', async () => {
    try {
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      if (!fs.existsSync(logFile)) fs.writeFileSync(logFile, '', 'utf8');
      const error = await shell.openPath(logFile);
      return error ? { ok: false, error } : { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('obxodik:relaunch-admin', () => {
    if (process.platform !== 'win32') {
      return { ok: false, error: 'Доступно только в Windows' };
    }
    const exe = process.execPath;
    const args = app.isPackaged ? [] : [app.getAppPath()];
    const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
    const argumentPart = args.length ? ` -ArgumentList ${quote(args.join(' '))}` : '';
    const command = `Start-Process -FilePath ${quote(exe)}${argumentPart} -Verb RunAs`;
    spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
    setTimeout(() => app.quit(), 300);
    return { ok: true };
  });

  ipcMain.handle('obxodik:quit', async () => {
    await requestQuit();
    return { ok: true };
  });
}

if (gotLock) {
  app.on('second-instance', () => {
    showWindow();
  });

  app.whenReady().then(async () => {
    engine.logLine(`Obxodik ${app.getVersion()} запущен`);
    await engine.cleanupStale();
    await tgws.cleanupStale();

    if (app.isPackaged) {
      const exists = await autostartExists();
      if (exists !== config.get().autostart) {
        config.update((data) => {
          data.autostart = exists;
        });
      }
    }

    registerIpc();
    const silent = process.argv.includes('--silent');
    createWindow({ show: !silent });
    createTray();

    const cfg = config.get();
    if (['youtube', 'discord', 'telegram'].some((id) => cfg.enabled[id])) {
      startEngine().then(() => {
        const current = config.get();
        if (current.telegramWs && current.enabled.telegram) startTgws();
      });
    } else {
      broadcast();
    }

    powerMonitor.on('resume', () => {
      const current = config.get();
      if (['youtube', 'discord', 'telegram'].some((id) => current.enabled[id])) {
        engine.logLine('Пробуждение системы: перезапуск обхода');
        restartEngine().then(() => {
          const fresh = config.get();
          if (fresh.telegramWs && fresh.enabled.telegram) startTgws();
        });
      }
    });

    app.on('activate', showWindow);
  });
}

app.on('before-quit', (event) => {
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  Promise.allSettled([engine.stop(), tgws.stop()]).finally(() => app.exit(0));
});

app.on('window-all-closed', () => {
  // Keep running in the tray; the engine must stay alive.
});
