# Сторонние компоненты

Obxodik использует открытый движок обхода DPI и драйвер перехвата пакетов.
Ниже перечислены компоненты, их лицензии и ссылки на исходный код.

## zapret / winws

- Файлы: `resources/zapret/bin/winws.exe`, `resources/zapret/bin/cygwin1.dll`,
  файлы `*.bin` с шаблонами пакетов, списки доменов.
- Автор: bol-van.
- Лицензия: MIT.
- Исходный код: https://github.com/bol-van/zapret
- Сборка Windows и списки: https://github.com/Flowseal/zapret-discord-youtube (MIT)
- Версия сборки: Flowseal zapret-discord-youtube 1.10.4 (20.10.2026).

Текст лицензии MIT:

```
MIT License

Copyright (c) 2016-2026 bol-van
Copyright (c) 2024-2026 Flowseal

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## WinDivert

- Файлы: `resources/zapret/bin/WinDivert.dll`, `resources/zapret/bin/WinDivert64.sys`.
- Автор: basil00 и участники проекта.
- Лицензия: LGPL-3.0 (библиотека), GPL-2.0 (драйвер); см. репозиторий.
- Исходный код: https://github.com/basil00/WinDivert
- Версия: 2.2.

WinDivert загружается движком только на время работы обхода. Драйвер не является
вирусом, но антивирусы могут помечать его как RiskTool из-за перехвата трафика.

## TG WS Proxy

- Файлы: `resources/tgws/tgws-core.exe` и `resources/tgws/_internal/**`.
- Автор: Flowseal.
- Лицензия: MIT.
- Исходный код: https://github.com/Flowseal/tg-ws-proxy
- Версия исходников: v1.11.2 (11.10.2026).
- Сборка: headless (без GUI и трея), выполнена из тега v1.11.2 скриптом
  `tools/build-tgws.ps1`. SHA256 `tgws-core.exe`:
  `17542752FB9DA08750C5B4D4C4EAC33303F520F66DC59EE8601EAF3109760DD8`.
- При работе прокси может загружать актуальный список Cloudflare-доменов с
  `raw.githubusercontent.com/Flowseal/tg-ws-proxy/main/.github/cfproxy-domains.txt`.
  Если загрузка недоступна, используются встроенные домены.

Текст лицензии MIT:

```
MIT License

Copyright (c) 2026 Flowseal

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Electron

- Лицензия: MIT.
- Исходный код: https://github.com/electron/electron

## electron-builder

- Лицензия: MIT.
- Исходный код: https://github.com/electron-userland/electron-builder

## Иконки брендов

Логотипы YouTube, Discord и Telegram являются товарными знаками соответствующих
правообладателей и используются только для обозначения совместимости.
Векторные контуры взяты из проекта Simple Icons (CC0 1.0).
