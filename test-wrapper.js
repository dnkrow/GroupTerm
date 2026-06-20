// Smoke test du wrapper gt.js : on l'héberge dans un pseudo-terminal, on tape une
// commande, et on vérifie via `peek` que sa sortie est bien diffusée au serveur.
// Vérifie aussi qu'un `say` entrant est injecté dans le shell (apparait à l'écran).
const pty = require('node-pty');
const { spawnSync } = require('child_process');

const SERVER = process.env.SERVER || 'ws://localhost:4343';
const ROOM = 'test-sp';
const SHELL = process.platform === 'win32' ? 'powershell.exe' : 'bash';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function tool(cmd, from, args = []) {
  const res = spawnSync(process.execPath, ['gt-tool.js', cmd, ...args], {
    env: { ...process.env, GT_SERVER: SERVER, GT_ROOM: ROOM, GT_NAME: from },
    encoding: 'utf8',
  });
  return (res.stdout || '') + (res.stderr || '');
}

let failures = 0;
const check = (c, l) => { console.log((c ? '✓ ' : '✗ ') + l); if (!c) failures++; };

async function run() {
  console.log('Smoke test wrapper gt.js');

  const host = pty.spawn(SHELL, [], { name: 'xterm-256color', cols: 100, rows: 30, cwd: process.cwd(), env: process.env });
  let out = '';
  host.onData((d) => { out += d; if (out.length > 20000) out = out.slice(-20000); });

  // Lance le wrapper dans le pseudo-terminal
  host.write(`node gt.js wrapuser ${ROOM}\r`);
  await wait(2500); // laisse le shell interne démarrer

  // Tape une commande dans le shell encapsulé
  host.write('echo SMOKE_OUTPUT_123\r');
  await wait(1500);

  // Un autre fait peek sur wrapuser -> doit voir la sortie
  const peekOut = tool('peek', 'observer', ['wrapuser']);
  check(peekOut.includes('SMOKE_OUTPUT_123'), 'la sortie du wrapper est diffusée (peek la voit)');

  // Un say entrant doit être injecté dans le shell (et donc apparaître à l'écran)
  tool('say', 'observer', ['--to', 'wrapuser', 'echo', 'INJECTED_456']);
  await wait(1500);
  check(out.includes('INJECTED_456'), 'un say entrant est injecté dans le terminal');

  host.kill();
  console.log(failures === 0 ? '\nWrapper OK.' : `\n${failures} échec(s).`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error('Erreur :', e); process.exit(1); });
