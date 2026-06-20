// Test du flux say/peek/chat en réseau (sans TTY).
// Connecte deux membres, vérifie peek (buffer), say (livraison) et chat (transcript).
const WebSocket = require('ws');
const { spawnSync } = require('child_process');

const SERVER = process.env.SERVER || 'ws://localhost:4343';
const ROOM = 'test-sp';

function member(name, role = 'human') {
  return new Promise((resolve) => {
    const ws = new WebSocket(SERVER);
    const inbox = [];
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === 'system' && m.text.includes('Bienvenue')) resolve({ ws, inbox });
      if (m.type === 'deliver') inbox.push(m);
    });
    ws.on('open', () => ws.send(JSON.stringify({ type: 'register', name, role, room: ROOM })));
  });
}

function tool(cmd, from, args = []) {
  const res = spawnSync(process.execPath, ['gt-tool.js', cmd, ...args], {
    env: { ...process.env, GT_SERVER: SERVER, GT_ROOM: ROOM, GT_NAME: from },
    encoding: 'utf8',
  });
  return (res.stdout || '') + (res.stderr || '');
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(cond, label) {
  if (cond) console.log('✓ ' + label);
  else { console.log('✗ ' + label); failures++; }
}

async function run() {
  console.log('Test say/peek/chat');
  const alice = await member('alice');
  const bob = await member('bob', 'ai');
  await wait(150);

  // alice produit de la sortie terminal
  alice.ws.send(JSON.stringify({ type: 'terminal', data: 'PS> git branch\r\n* feature-login\r\n' }));
  await wait(200);

  // bob fait peek (cible auto = alice)
  const peekOut = tool('peek', 'bob');
  check(peekOut.includes('feature-login'), 'peek lit le terminal de l\'autre');
  check(peekOut.includes('terminal de alice'), 'peek indique la cible');

  // bob fait say -> doit être livré à alice
  const sayOut = tool('say', 'bob', ['Salut', 'Alice', 'ça', 'avance', '?']);
  check(sayOut.includes('[say -> alice]'), 'say confirme l\'envoi');
  await wait(300);
  check(alice.inbox.some((m) => m.from === 'bob' && m.text === 'Salut Alice ça avance ?'), 'say livré à alice (deliver)');

  // chat doit contenir le message
  const chatOut = tool('chat', 'alice');
  check(chatOut.includes('bob: Salut Alice ça avance ?'), 'chat affiche le transcript');

  // peek sans cible quand personne d'autre -> message clair (room à un seul)
  const lonelyOut = tool('peek', 'ghost'); // ghost n'est pas membre, alice+bob le sont -> 2 autres
  check(lonelyOut.includes('Plusieurs personnes') || lonelyOut.includes('précise un nom'), 'peek ambigu demande un nom');

  alice.ws.close();
  bob.ws.close();
  console.log(failures === 0 ? '\nTous les tests passent.' : `\n${failures} test(s) en échec.`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error('Erreur test :', e); process.exit(1); });
