# Сборка headless-версии TG WS Proxy

Obxodik использует не официальный tray-EXE, а собственную headless-сборку
ядра [Flowseal/tg-ws-proxy](https://github.com/Flowseal/tg-ws-proxy) (MIT).
Так прокси управляется напрямую из Obxodik и не создаёт второй значок в трее.

## Требования

- Windows 10/11 x64
- Python 3.12+
- интернет для загрузки зависимостей

## Сборка

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\build-tgws.ps1
```

Скрипт:

1. скачивает исходники тега `v1.11.2`;
2. создаёт временное окружение и ставит `pyinstaller`, `httpx[http2]`, `cryptography`, `certifi`;
3. собирает `tgws-core.exe` с CLI-интерфейсом ядра (без GUI и трея);
4. кладёт результат в `resources/tgws/tgws-core.exe` вместе с папкой `_internal`.

Сборка используется в режиме `--onedir`: это один процесс без дочернего
загрузчика PyInstaller, поэтому Obxodik может корректно останавливать прокси.

## Проверка

```powershell
resources\tgws\tgws-core.exe --help
```

Версия исходников: `v1.11.2` (11.10.2026). Итоговый размер каталога — около 31 МБ.
