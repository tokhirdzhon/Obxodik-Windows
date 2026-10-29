'use strict';

(() => {
  const PREVIEW = !window.obxodik && location.protocol === 'http:';
  const DEMO = PREVIEW;
  const api = window.obxodik || (PREVIEW ? createDemoApi() : null);

  const els = {
    enginePill: document.getElementById('enginePill'),
    engineText: document.getElementById('engineText'),
    statusCard: document.querySelector('.status-card'),
    statusOrb: document.getElementById('statusOrb'),
    statusTitle: document.getElementById('statusTitle'),
    statusSub: document.getElementById('statusSub'),
    masterBtn: document.getElementById('masterBtn'),
    masterText: document.getElementById('masterText'),
    strategySelect: document.getElementById('strategySelect'),
    strategyHint: document.getElementById('strategyHint'),
    ipsetSelect: document.getElementById('ipsetSelect'),
    ipsetHint: document.getElementById('ipsetHint'),
    autostartToggle: document.getElementById('autostartToggle'),
    wsToggle: document.getElementById('wsToggle'),
    tgwsBar: document.getElementById('tgwsBar'),
    tgwsText: document.getElementById('tgwsText'),
    tgConnectBtn: document.getElementById('tgConnectBtn'),
    tgCopyBtn: document.getElementById('tgCopyBtn'),
    proxyBtn: document.getElementById('proxyBtn'),
    testBtn: document.getElementById('testBtn'),
    logsBtn: document.getElementById('logsBtn'),
    exitBtn: document.getElementById('exitBtn'),
    quitBtn: document.getElementById('quitBtn'),
    testResults: document.getElementById('testResults'),
    logPanel: document.getElementById('logPanel'),
    logView: document.getElementById('logView'),
    copyLogsBtn: document.getElementById('copyLogsBtn'),
    openLogsBtn: document.getElementById('openLogsBtn'),
    engineLink: document.getElementById('engineLink'),
    versionText: document.getElementById('versionText'),
    demohint: document.getElementById('demohint'),
    proxyModal: document.getElementById('proxyModal'),
    proxyInput: document.getElementById('proxyInput'),
    proxyClose: document.getElementById('proxyClose'),
    proxyCancel: document.getElementById('proxyCancel'),
    proxySubmit: document.getElementById('proxySubmit'),
    toast: document.getElementById('toast'),
  };

  const SERVICE_NAMES = {
    youtube: 'YouTube',
    discord: 'Discord',
    telegram: 'Telegram',
  };

  let state = null;
  let pending = false;
  let testInFlight = false;
  let logLines = [];
  let toastTimer = null;
  let logsOpen = false;

  if (!api) {
    document.body.innerHTML = '<div class="fatal"><h1>Obxodik</h1><p>Не удалось загрузить интерфейс приложения. Перезапустите Obxodik или переустановите его.</p></div>';
    return;
  }

  if (DEMO) els.demohint.classList.remove('hidden');

  function names(enabled) {
    return Object.keys(SERVICE_NAMES).filter((id) => enabled[id]).map((id) => SERVICE_NAMES[id]);
  }

  function render() {
    if (!state) return;
    const status = state.engine.status;
    const enabledNames = names(state.enabled);
    const active = enabledNames.length > 0;
    const running = status === 'running';
    const starting = status === 'starting';
    const stopping = status === 'stopping';
    const errored = status === 'error';
    const transitioning = starting || stopping;

    els.enginePill.classList.toggle('is-running', running);
    els.enginePill.classList.toggle('is-starting', starting || stopping);
    els.enginePill.classList.toggle('is-error', errored);
    els.engineText.textContent = running
      ? 'Работает'
      : starting
        ? 'Запуск…'
        : stopping
          ? 'Остановка…'
          : errored
            ? 'Ошибка'
            : 'Выключен';

    els.statusCard.classList.toggle('is-running', running);
    els.statusCard.classList.toggle('is-error', errored);

    if (running) {
      els.statusTitle.textContent = 'Обход работает';
      const ipsetNote = state.ipsetMode === 'none'
        ? 'IPSet: только домены, остальной трафик напрямую.'
        : state.ipsetMode === 'any'
          ? 'IPSet: обрабатываются все IP на портах обхода.'
          : 'IPSet: добавлены IP из списка заблокированных ресурсов.';
      els.statusSub.textContent = enabledNames.length
        ? `Активно: ${enabledNames.join(', ')}. ${ipsetNote}`
        : 'Выберите приложения, для которых нужен обход.';
      els.statusSub.classList.remove('is-error');
    } else if (starting) {
      els.statusTitle.textContent = 'Включаем обход…';
      els.statusSub.textContent = 'Применяем стратегию и запускаем локальный движок.';
      els.statusSub.classList.remove('is-error');
    } else if (stopping) {
      els.statusTitle.textContent = 'Выключаем обход…';
      els.statusSub.textContent = 'Останавливаем движок и возвращаем обычный маршрут.';
      els.statusSub.classList.remove('is-error');
    } else if (errored) {
      els.statusTitle.textContent = 'Обход не запустился';
      const wsNote = state.tgws && state.tgws.status === 'running' ? ' Telegram работает через WS-прокси.' : '';
      els.statusSub.textContent = (state.engine.error || 'Откройте журнал, чтобы увидеть подробности.') + wsNote;
      els.statusSub.classList.add('is-error');
    } else {
      els.statusTitle.textContent = 'Обход выключен';
      els.statusSub.textContent = active
        ? 'Нажмите «Включить обход», чтобы применить настройки.'
        : 'Включите нужные приложения — трафик остальных не затрагивается.';
      els.statusSub.classList.remove('is-error');
    }

    const masterLabel = running
      ? 'Выключить всё'
      : transitioning
        ? 'Подождите…'
        : errored
          ? (state.isAdmin ? 'Повторить' : 'Перезапустить')
          : active
            ? 'Включить обход'
            : 'Включить всё';
    els.masterText.textContent = masterLabel;
    els.masterBtn.disabled = pending || transitioning;
    els.masterBtn.classList.toggle('is-busy', pending);

    document.querySelectorAll('[data-toggle]').forEach((input) => {
      const id = input.dataset.toggle;
      input.checked = Boolean(state.enabled[id]);
      input.disabled = pending || transitioning;
    });

    const tgwsRunning = Boolean(state.tgws && state.tgws.status === 'running');
    document.querySelectorAll('.app-card').forEach((card) => {
      const id = card.dataset.app;
      const on = Boolean(state.enabled[id]);
      card.classList.toggle('is-on', on);
      card.classList.toggle('is-degraded', on && !running && !(id === 'telegram' && tgwsRunning));
      const label = card.querySelector('[data-state]');
      if (!on) label.textContent = 'Выключен';
      else if (id === 'telegram' && tgwsRunning) label.textContent = running ? 'Обход + WS-прокси' : 'WS-прокси активен';
      else if (running) label.textContent = 'Обход активен';
      else if (errored) label.textContent = 'Ошибка запуска';
      else if (starting) label.textContent = 'Запускается…';
      else label.textContent = 'Ожидает включения';
    });

    if (els.strategySelect.options.length === 0) {
      for (const strategy of state.strategies) {
        const option = document.createElement('option');
        option.value = strategy.id;
        option.textContent = strategy.label;
        els.strategySelect.appendChild(option);
      }
    }
    els.strategySelect.value = state.strategy;
    els.strategySelect.disabled = pending || transitioning;
    const current = state.strategies.find((s) => s.id === state.strategy);
    els.strategyHint.textContent = current ? current.hint : '';

    if (els.ipsetSelect.options.length === 0) {
      for (const mode of state.ipsetModes) {
        const option = document.createElement('option');
        option.value = mode.id;
        option.textContent = mode.label;
        els.ipsetSelect.appendChild(option);
      }
    }
    els.ipsetSelect.value = state.ipsetMode;
    els.ipsetSelect.disabled = pending || transitioning;
    const currentIpset = state.ipsetModes.find((mode) => mode.id === state.ipsetMode);
    els.ipsetHint.textContent = currentIpset ? currentIpset.hint : '';

    els.autostartToggle.checked = Boolean(state.autostart);
    els.autostartToggle.disabled = pending || !state.packaged;
    els.autostartToggle.parentElement.title = state.packaged
      ? 'Включать обход при входе в Windows'
      : 'Доступно в установленной версии Obxodik';
    els.proxyBtn.disabled = pending;

    renderTgws(transitioning);

    els.versionText.textContent = state.version;

    if (state.lastTest) renderTest(state.lastTest);
    renderLogs();
  }

  function renderTgws(transitioning) {
    const tgws = state.tgws || { status: 'stopped' };
    const telegramOn = Boolean(state.enabled.telegram);
    const available = tgws.available !== false;
    const status = tgws.status || 'stopped';
    const wsOn = Boolean(state.telegramWs);

    els.wsToggle.checked = wsOn;
    els.wsToggle.disabled = pending || transitioning || (!wsOn && (!telegramOn || !available));

    const tileNote = els.wsToggle.closest('.setting-tile')?.querySelector('.setting-label p');
    if (tileNote) {
      tileNote.textContent = !available
        ? 'Компонент не найден — переустановите Obxodik'
        : !telegramOn
          ? 'Сначала включите Telegram выше'
          : 'Локальный MTProto → WebSocket, обходит блокировку по IP';
    }

    els.tgwsBar.classList.toggle('is-running', status === 'running');
    els.tgwsBar.classList.toggle('is-starting', status === 'starting' || status === 'stopping');
    els.tgwsBar.classList.toggle('is-error', status === 'error');

    let text;
    if (!available) {
      text = 'Компонент WS-прокси не найден';
    } else if (!telegramOn) {
      text = 'Telegram выключен';
    } else if (status === 'running') {
      text = `127.0.0.1:${tgws.port} · прокси запущен`;
    } else if (status === 'starting') {
      text = 'Запуск WS-прокси…';
    } else if (status === 'stopping') {
      text = 'Остановка WS-прокси…';
    } else if (status === 'error') {
      text = tgws.error || 'WS-прокси не запустился';
    } else if (wsOn) {
      text = 'WS-прокси готов к запуску';
    } else {
      text = 'WS-прокси выключен · включите, если Telegram блокируется по IP';
    }
    els.tgwsText.textContent = text;
    els.tgwsText.title = text;

    const running = status === 'running';
    els.tgConnectBtn.classList.toggle('hidden', !running);
    els.tgCopyBtn.classList.toggle('hidden', !running);
    els.tgConnectBtn.disabled = pending;
    els.tgCopyBtn.disabled = pending;
  }

  function renderTest(test) {
    const { results } = test;
    els.testResults.classList.remove('hidden');
    els.testResults.replaceChildren();
    for (const result of results) {
      const row = document.createElement('div');
      row.className = `test-item ${result.ok ? 'ok' : 'bad'}`;
      row.dataset.id = result.id;

      const brand = document.createElement('span');
      brand.className = 'test-brand';
      brand.textContent = result.id === 'youtube' ? 'YT' : result.id === 'discord' ? 'DC' : 'TG';

      const info = document.createElement('div');
      info.className = 'test-info';
      const title = document.createElement('strong');
      title.textContent = result.label;
      const meta = document.createElement('span');
      meta.textContent = result.ok
        ? `HTTP ${result.status} · ${result.elapsed} мс`
        : result.error || 'Нет соединения';
      info.append(title, meta);

      const badge = document.createElement('span');
      badge.className = 'test-badge';
      badge.title = result.ok ? 'Доступно' : 'Недоступно';

      row.append(brand, info, badge);
      els.testResults.appendChild(row);
    }
    if (state.tgws && state.tgws.status === 'running') {
      const note = document.createElement('div');
      note.className = 'test-note';
      note.textContent = `Проверка Telegram выше — прямое соединение. Приложение использует WS-прокси 127.0.0.1:${state.tgws.port}.`;
      els.testResults.appendChild(note);
    }
  }

  function renderLogs() {
    if (!logsOpen) return;
    const pre = els.logView;
    const nearBottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 40;
    pre.textContent = logLines.length ? logLines.join('\n') : 'Журнал пока пуст.';
    if (nearBottom) pre.scrollTop = pre.scrollHeight;
  }

  function setBusy(value) {
    pending = value;
    render();
  }

  async function apply(factory) {
    if (pending) return;
    setBusy(true);
    try {
      const result = await factory();
      if (result && result.ok === false) {
        toast(result.error || 'Не удалось применить настройку', 'error');
        const fresh = await api.getState();
        if (fresh) state = fresh;
      } else if (result && result.state) {
        state = result.state;
      }
      return result;
    } catch (error) {
      toast(error && error.message ? error.message : 'Неизвестная ошибка', 'error');
      try {
        const fresh = await api.getState();
        if (fresh) state = fresh;
      } catch {
        // ignore
      }
    } finally {
      pending = false;
      render();
    }
  }

  function toast(message, kind = 'info') {
    els.toast.textContent = message;
    els.toast.className = `toast ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 4800);
  }

  function openProxyModal() {
    els.proxyInput.value = state.telegramProxy || '';
    els.proxyModal.classList.remove('hidden');
    setTimeout(() => els.proxyInput.focus(), 40);
  }

  function closeProxyModal() {
    els.proxyModal.classList.add('hidden');
  }

  function quitApp() {
    if (DEMO) {
      toast('В демо-режиме приложение не закрывается');
      return;
    }
    api.quit();
  }

  // ---- events -------------------------------------------------------------

  document.querySelectorAll('[data-toggle]').forEach((input) => {
    input.addEventListener('change', () => {
      const id = input.dataset.toggle;
      const value = input.checked;
      if (state) state.enabled[id] = value;
      render();
      apply(() => api.setService(id, value));
    });
  });

  els.masterBtn.addEventListener('click', () => {
    if (!state || pending) return;
    const status = state.engine.status;
    const anyEnabled = names(state.enabled).length > 0;
    if (status === 'error' && !state.isAdmin) {
      api.relaunchAdmin();
      return;
    }
    if (status === 'running') {
      apply(() => api.setAll(false));
    } else if (status === 'error') {
      apply(() => api.restart());
    } else if (anyEnabled) {
      apply(() => api.restart());
    } else {
      apply(() => api.setAll(true));
    }
  });

  els.strategySelect.addEventListener('change', () => {
    const strategy = els.strategySelect.value;
    apply(() => api.setStrategy(strategy));
  });

  els.ipsetSelect.addEventListener('change', () => {
    const mode = els.ipsetSelect.value;
    if (state) state.ipsetMode = mode;
    render();
    apply(() => api.setIpsetMode(mode));
  });

  els.autostartToggle.addEventListener('change', async () => {
    const value = els.autostartToggle.checked;
    if (state) state.autostart = value;
    render();
    const result = await apply(() => api.setAutostart(value));
    if (result && result.ok) {
      toast(value ? 'Автозапуск включён' : 'Автозапуск выключен', 'success');
    }
  });

  els.wsToggle.addEventListener('change', async () => {
    const value = els.wsToggle.checked;
    if (state) state.telegramWs = value;
    render();
    const result = await apply(() => api.setTelegramWs(value));
    if (result && result.ok) {
      if (result.message) toast(result.message, 'success');
      else if (!value) toast('WS-прокси выключен', 'success');
    }
  });

  els.tgConnectBtn.addEventListener('click', async () => {
    const result = await api.tgwsConnect();
    if (result && result.ok) toast(result.message || 'Ссылка передана в Telegram', 'success');
    else toast((result && result.error) || 'Не удалось открыть Telegram', 'error');
  });

  els.tgCopyBtn.addEventListener('click', async () => {
    const result = await api.tgwsCopy();
    if (result && result.ok) toast(result.message || 'Ссылка скопирована', 'success');
    else toast((result && result.error) || 'Не удалось скопировать ссылку', 'error');
  });

  els.testBtn.addEventListener('click', async () => {
    if (testInFlight) return;
    testInFlight = true;
    els.testBtn.classList.add('is-busy');
    els.testBtn.disabled = true;
    try {
      const result = await api.test();
      if (result && result.ok) {
        state.lastTest = result.test;
        renderTest(result.test);
        const failed = result.test.results.filter((r) => !r.ok);
        if (failed.length === 0) toast('Все проверки пройдены', 'success');
        else toast(`Недоступно: ${failed.map((r) => r.label).join(', ')}`, 'error');
      } else {
        toast((result && result.error) || 'Проверка не удалась', 'error');
      }
    } catch (error) {
      toast(error.message || 'Проверка не удалась', 'error');
    } finally {
      testInFlight = false;
      els.testBtn.classList.remove('is-busy');
      els.testBtn.disabled = false;
    }
  });

  els.logsBtn.addEventListener('click', () => {
    logsOpen = !logsOpen;
    els.logPanel.classList.toggle('hidden', !logsOpen);
    if (logsOpen) {
      renderLogs();
      els.logView.scrollTop = els.logView.scrollHeight;
    }
  });

  els.copyLogsBtn.addEventListener('click', async () => {
    const text = logLines.join('\n');
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const area = document.createElement('textarea');
        area.value = text;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        area.remove();
      }
      toast('Журнал скопирован', 'success');
    } catch {
      toast('Не удалось скопировать журнал', 'error');
    }
  });

  els.openLogsBtn.addEventListener('click', async () => {
    const result = await api.openLogs();
    if (result && result.ok === false) toast(result.error || 'Не удалось открыть журнал', 'error');
  });

  els.engineLink.addEventListener('click', () => {
    api.openExternal('https://github.com/bol-van/zapret');
  });

  els.proxyBtn.addEventListener('click', openProxyModal);
  els.proxyClose.addEventListener('click', closeProxyModal);
  els.proxyCancel.addEventListener('click', closeProxyModal);
  els.proxyModal.addEventListener('click', (event) => {
    if (event.target === els.proxyModal) closeProxyModal();
  });

  els.proxySubmit.addEventListener('click', async () => {
    const value = els.proxyInput.value.trim();
    if (!value) {
      toast('Вставьте ссылку на прокси', 'error');
      return;
    }
    els.proxySubmit.disabled = true;
    els.proxySubmit.classList.add('is-busy');
    try {
      const result = await api.telegramProxy(value);
      if (result && result.ok) {
        toast(result.message || 'Ссылка передана в Telegram', 'success');
        closeProxyModal();
      } else {
        toast((result && result.error) || 'Некорректная ссылка', 'error');
      }
    } catch (error) {
      toast(error.message || 'Ошибка', 'error');
    } finally {
      els.proxySubmit.disabled = false;
      els.proxySubmit.classList.remove('is-busy');
    }
  });

  els.exitBtn.addEventListener('click', quitApp);
  els.quitBtn.addEventListener('click', quitApp);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !els.proxyModal.classList.contains('hidden')) {
      closeProxyModal();
    }
  });

  api.onState((next) => {
    state = next;
    render();
  });

  api.onLog((entry) => {
    if (!entry) return;
    if (logLines[logLines.length - 1] === entry) return;
    logLines.push(entry);
    if (logLines.length > 400) logLines = logLines.slice(-400);
    renderLogs();
  });

  (async () => {
    try {
      state = await api.getState();
      logLines = Array.isArray(state.logs) ? state.logs.slice(-400) : [];
      render();
    } catch (error) {
      els.statusTitle.textContent = 'Не удалось загрузить состояние';
      els.statusSub.textContent = error.message || String(error);
      els.statusSub.classList.add('is-error');
    }
  })();

  // ---- demo mode (used only for static UI preview) ------------------------

  function createDemoApi() {
    const listeners = { state: [], log: [] };
    const demo = {
      version: '1.0.0',
      isAdmin: true,
      packaged: true,
      platform: 'win32',
      enabled: { youtube: true, discord: true, telegram: true },
      strategy: 'universal',
      ipsetMode: 'loaded',
      autostart: false,
      telegramWs: true,
      telegramProxy: '',
      engine: { status: 'running', error: null, pid: 4321, args: [] },
      tgws: {
        status: 'running',
        error: null,
        port: 1443,
        link: 'tg://proxy?server=127.0.0.1&port=1443&secret=dd0123456789abcdef0123456789abcdef',
        pid: 4322,
        available: true,
      },
      strategies: [
        { id: 'universal', label: 'Универсальная (multisplit)', hint: 'Рекомендуется для большинства провайдеров' },
        { id: 'fake', label: 'Fake TLS', hint: 'Подмена первого пакета, если multisplit не помогает' },
        { id: 'fake_split', label: 'Fake + fakedsplit', hint: 'Комбинированная стратегия для сложного DPI' },
        { id: 'fake_auto', label: 'Fake TLS Auto (multidisorder)', hint: 'Автоматическая подмена TLS с перемешиванием' },
      ],
      ipsetModes: [
        { id: 'loaded', label: 'loaded — только IP из списка', hint: 'Обрабатывать только IP из списка заблокированных ресурсов' },
        { id: 'any', label: 'any — все IP-адреса', hint: 'Обрабатывать все IP (может затронуть лишний трафик)' },
        { id: 'none', label: 'none — IP-фильтр выключен', hint: 'Не фильтровать трафик по IP-адресам' },
      ],
      logs: [
        '[12:00:01] Obxodik 1.0.0 запущен',
        '[12:00:01] Запуск: winws.exe --wf-tcp=80,443,2053,2083,2087,2096,8443 --wf-udp=443,19294-19344,50000-50100 …',
        '[12:00:02] windivert: loaded (WinDivert 2.2)',
        '[12:00:02] Обход запущен',
      ],
      lastTest: {
        at: Date.now(),
        results: [
          { id: 'youtube', label: 'YouTube', ok: true, status: 204, elapsed: 118, dns: '142.250.74.142' },
          { id: 'discord', label: 'Discord', ok: true, status: 200, elapsed: 164, dns: '162.159.135.232' },
          { id: 'telegram', label: 'Telegram', ok: true, status: 200, elapsed: 92, dns: '149.154.167.99' },
        ],
      },
      getState: async () => JSON.parse(JSON.stringify(demo)),
      setService: async (id, enabled) => {
        demo.enabled[id] = enabled;
        const any = Object.values(demo.enabled).some(Boolean);
        demo.engine.status = any ? 'running' : 'stopped';
        if (id === 'telegram') {
          demo.tgws.status = enabled && demo.telegramWs ? 'running' : 'stopped';
        }
        return { ok: true, state: JSON.parse(JSON.stringify(demo)) };
      },
      setAll: async (enabled) => {
        demo.enabled = { youtube: enabled, discord: enabled, telegram: enabled };
        demo.engine.status = enabled ? 'running' : 'stopped';
        return { ok: true, state: JSON.parse(JSON.stringify(demo)) };
      },
      setStrategy: async (strategy) => {
        demo.strategy = strategy;
        return { ok: true, state: JSON.parse(JSON.stringify(demo)) };
      },
      setIpsetMode: async (mode) => {
        demo.ipsetMode = mode;
        return { ok: true, state: JSON.parse(JSON.stringify(demo)) };
      },
      setAutostart: async (enabled) => {
        demo.autostart = enabled;
        return { ok: true, state: JSON.parse(JSON.stringify(demo)) };
      },
      setTelegramWs: async (enabled) => {
        demo.telegramWs = enabled;
        demo.tgws.status = enabled ? 'running' : 'stopped';
        return {
          ok: true,
          state: JSON.parse(JSON.stringify(demo)),
          message: enabled ? 'WS-прокси запущен. Подтвердите подключение в Telegram.' : undefined,
        };
      },
      tgwsConnect: async () => ({ ok: true, message: 'Ссылка передана в Telegram' }),
      tgwsCopy: async () => ({ ok: true, message: 'Ссылка на WS-прокси скопирована' }),
      restart: async () => {
        demo.engine.status = 'running';
        return { ok: true, state: JSON.parse(JSON.stringify(demo)) };
      },
      test: async () => ({ ok: true, test: demo.lastTest }),
      telegramProxy: async () => ({ ok: true, message: 'Ссылка передана в Telegram' }),
      openExternal: async () => ({ ok: true }),
      openLogs: async () => ({ ok: false, error: 'В демо-режиме журнал недоступен' }),
      relaunchAdmin: async () => ({ ok: true }),
      quit: async () => ({ ok: true }),
      onState: (callback) => {
        listeners.state.push(callback);
        return () => {};
      },
      onLog: (callback) => {
        listeners.log.push(callback);
        return () => {};
      },
    };
    return demo;
  }
})();
