'use strict';

const path = require('node:path');

const TCP_PORTS = ['80', '443', '2053', '2083', '2087', '2096', '8443'];
const UDP_PORTS = ['443', '19294-19344', '50000-50100'];
const DISCORD_ALT_TCP = ['2053', '2083', '2087', '2096', '8443'];

const STRATEGIES = [
  {
    id: 'universal',
    label: 'Универсальная (multisplit)',
    hint: 'Рекомендуется для большинства провайдеров',
  },
  {
    id: 'fake',
    label: 'Fake TLS',
    hint: 'Подмена первого пакета, если multisplit не помогает',
  },
  {
    id: 'fake_split',
    label: 'Fake + fakedsplit',
    hint: 'Комбинированная стратегия для сложного DPI',
  },
  {
    id: 'fake_auto',
    label: 'Fake TLS Auto (multidisorder)',
    hint: 'Автоматическая подмена TLS с перемешиванием',
  },
];

const STRATEGY_IDS = STRATEGIES.map((s) => s.id);

const IPSET_MODES = [
  {
    id: 'loaded',
    label: 'loaded — только IP из списка',
    hint: 'Обрабатывать только IP из списка заблокированных ресурсов',
  },
  {
    id: 'any',
    label: 'any — все IP-адреса',
    hint: 'Обрабатывать все IP (может затронуть лишний трафик)',
  },
  {
    id: 'none',
    label: 'none — IP-фильтр выключен',
    hint: 'Не фильтровать трафик по IP-адресам',
  },
];

const IPSET_MODE_IDS = IPSET_MODES.map((mode) => mode.id);

function existsIn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * Builds the winws.exe argument list for the selected services.
 * Only profiles of enabled services are included, so each toggle really
 * enables/disables its own traffic class.
 */
function buildArgs({ enabled = {}, strategy = 'universal', ipsetMode = 'loaded', binDir, listsDir }) {
  if (!binDir || !listsDir) throw new Error('binDir and listsDir are required');

  const mode = IPSET_MODE_IDS.includes(ipsetMode) ? ipsetMode : 'loaded';

  // Absolute paths are required: winws resolves relative list paths against
  // EXEDIR unpredictably and refuses to start. Forward slashes keep Cygwin happy;
  // Node quotes each argument that contains spaces (e.g. "Program Files").
  const enginePath = (absolute) => absolute.split(path.sep).join('/');
  const bin = (name) => enginePath(path.join(binDir, name));
  const list = (name) => enginePath(path.join(listsDir, name));
  const excludeHostlist = [
    `--hostlist-exclude=${list('list-exclude.txt')}`,
  ];
  const excludeIpset = mode === 'none'
    ? []
    : [`--ipset-exclude=${list('ipset-exclude.txt')}`];
  const exclude = [...excludeHostlist, ...excludeIpset];

  const profiles = [];
  const add = (filters, desync) => profiles.push([
    ...(Array.isArray(filters) ? filters : [filters]),
    ...desync,
  ]);

  const tlsDesync = () => {
    switch (strategy) {
      case 'fake':
        return [
          '--dpi-desync=fake',
          '--dpi-desync-repeats=6',
          '--dpi-desync-fooling=ts',
          `--dpi-desync-fake-tls=${bin('tls_clienthello_www_google_com.bin')}`,
          '--ip-id=zero',
        ];
      case 'fake_split':
        return [
          '--dpi-desync=fake,fakedsplit',
          '--dpi-desync-repeats=6',
          '--dpi-desync-fooling=ts',
          '--dpi-desync-fakedsplit-pattern=0x00',
          `--dpi-desync-fake-tls=${bin('tls_clienthello_www_google_com.bin')}`,
          '--ip-id=zero',
        ];
      case 'fake_auto':
        return [
          '--dpi-desync=fake,multidisorder',
          '--dpi-desync-split-pos=1,midsld',
          '--dpi-desync-repeats=11',
          '--dpi-desync-fooling=badseq',
          '--dpi-desync-fake-tls=0x00000000',
          '--dpi-desync-fake-tls=!',
          '--dpi-desync-fake-tls-mod=rnd,dupsid,sni=www.google.com',
          '--ip-id=zero',
        ];
      case 'universal':
      default:
        return [
          '--dpi-desync=multisplit',
          '--dpi-desync-split-seqovl=681',
          '--dpi-desync-split-pos=1',
          `--dpi-desync-split-seqovl-pattern=${bin('tls_clienthello_www_google_com.bin')}`,
          '--ip-id=zero',
        ];
    }
  };

  const httpDesync = () => {
    switch (strategy) {
      case 'fake':
        return [
          '--dpi-desync=fake',
          '--dpi-desync-repeats=6',
          '--dpi-desync-fooling=ts',
          `--dpi-desync-fake-http=${bin('tls_clienthello_www_sferum_ru.bin')}`,
        ];
      case 'fake_split':
        return [
          '--dpi-desync=fake,fakedsplit',
          '--dpi-desync-repeats=6',
          '--dpi-desync-fooling=ts',
          '--dpi-desync-fakedsplit-pattern=0x00',
          `--dpi-desync-fake-http=${bin('tls_clienthello_www_sferum_ru.bin')}`,
        ];
      case 'fake_auto':
        return [
          '--dpi-desync=fake,multidisorder',
          '--dpi-desync-split-pos=1,midsld',
          '--dpi-desync-repeats=11',
          '--dpi-desync-fooling=badseq',
          `--dpi-desync-fake-http=${bin('tls_clienthello_www_sferum_ru.bin')}`,
        ];
      case 'universal':
      default:
        return [
          '--dpi-desync=multisplit',
          '--dpi-desync-split-seqovl=568',
          '--dpi-desync-split-pos=1',
          `--dpi-desync-split-seqovl-pattern=${bin('tls_clienthello_4pda_to.bin')}`,
        ];
    }
  };

  const quicDesync = () => [
    '--dpi-desync=fake',
    '--dpi-desync-repeats=6',
    `--dpi-desync-fake-quic=${bin('quic_initial_www_google_com.bin')}`,
  ];

  const telegramDesync = () => {
    // Telegram uses its own binary protocol (MTProto), so only protocol-agnostic
    // splitting makes sense here. The exact split offset varies by strategy.
    const seqovl = strategy === 'fake' ? '652' : strategy === 'fake_split' ? '568' : '681';
    const pattern = strategy === 'fake_split'
      ? 'tls_clienthello_4pda_to.bin'
      : 'tls_clienthello_www_google_com.bin';
    return [
      '--dpi-desync=multisplit',
      '--dpi-desync-split-seqovl=' + seqovl,
      '--dpi-desync-split-pos=1',
      `--dpi-desync-split-seqovl-pattern=${bin(pattern)}`,
      '--dpi-desync-any-protocol=1',
      '--dpi-desync-cutoff=n3',
    ];
  };

  if (enabled.youtube) {
    add([`--filter-udp=443`, `--hostlist=${list('list-youtube.txt')}`], [
      ...quicDesync(),
      ...exclude,
    ]);
    add([`--filter-tcp=443`, `--hostlist=${list('list-youtube.txt')}`], [
      ...tlsDesync(),
      ...exclude,
    ]);
    add([`--filter-tcp=80`, `--hostlist=${list('list-youtube.txt')}`], [
      ...httpDesync(),
      ...exclude,
    ]);
  }

  if (enabled.discord) {
    add(
      ['--filter-udp=19294-19344,50000-50100', '--filter-l7=discord,stun'],
      [
        '--dpi-desync=fake',
        `--dpi-desync-fake-discord=${bin('ACTIVE_DISCORD_UDP.bin')}`,
        `--dpi-desync-fake-stun=${bin('ACTIVE_DISCORD_UDP.bin')}`,
        '--dpi-desync-repeats=6',
      ],
    );
    add([`--filter-tcp=443`, `--hostlist=${list('list-discord.txt')}`], [
      ...tlsDesync(),
      ...exclude,
    ]);
    add(
      [`--filter-tcp=${DISCORD_ALT_TCP.join(',')}`, `--hostlist=${list('list-discord.txt')}`],
      [...tlsDesync(), ...exclude],
    );
    add([`--filter-tcp=80`, `--hostlist=${list('list-discord.txt')}`], [
      ...httpDesync(),
      ...exclude,
    ]);
  }

  if (enabled.telegram) {
    // ipset and hostlist in the same profile are ANDed (ipset is a hard filter),
    // so Telegram needs separate profiles: one for MTProto IPs (no SNI) and one
    // for Telegram domains hosted outside the official ranges.
    if (mode !== 'none') {
      add(
        [`--filter-tcp=443`, `--ipset=${list('ipset-telegram.txt')}`],
        [...telegramDesync(), ...excludeIpset],
      );
    }
    add(
      [`--filter-tcp=443`, `--hostlist=${list('list-telegram.txt')}`],
      [...telegramDesync(), ...exclude],
    );
    if (mode !== 'none') {
      add(
        [`--filter-tcp=80`, `--ipset=${list('ipset-telegram.txt')}`],
        [...telegramDesync(), ...excludeIpset],
      );
    }
    add(
      [`--filter-tcp=80`, `--hostlist=${list('list-telegram.txt')}`],
      [...telegramDesync(), ...exclude],
    );
  }

  // Global IP layer controlled by the IPSet mode:
  //   loaded -> only IPs from ipset-all.txt
  //   any    -> every IP address
  //   none   -> no IP-based profiles at all
  const anyService = enabled.youtube || enabled.discord || enabled.telegram;
  if (mode !== 'none' && anyService) {
    const ipsetArgs = mode === 'any'
      ? ['--ipset-ip=0.0.0.0/0,::/0']
      : [`--ipset=${list('ipset-all.txt')}`];

    add(
      [`--filter-tcp=${TCP_PORTS.join(',')}`, ...ipsetArgs],
      [...telegramDesync(), ...excludeIpset],
    );
    add(
      ['--filter-udp=443', '--filter-l7=quic', ...ipsetArgs],
      [...quicDesync(), ...excludeIpset],
    );
  }

  const args = [
    `--wf-tcp=${TCP_PORTS.join(',')}`,
    `--wf-udp=${UDP_PORTS.join(',')}`,
  ];

  for (const profile of profiles) {
    args.push(...profile, '--new');
  }
  args.pop();

  return args;
}

function enabledCount(enabled) {
  return ['youtube', 'discord', 'telegram'].filter((id) => enabled[id]).length;
}

module.exports = {
  STRATEGIES,
  STRATEGY_IDS,
  IPSET_MODES,
  IPSET_MODE_IDS,
  TCP_PORTS,
  UDP_PORTS,
  buildArgs,
  enabledCount,
  existsIn,
};
