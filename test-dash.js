// Test du flux "tableau de bord" : abonnement watch, snapshot, roster live,
// chat-event poussé, et commande outil `who`.
// (Comme les autres tests : un serveur de test doit tourner sur SERVER.)
const WebSocket = require('ws');
const { spawnSync } = require('child_process');

const SERVER = process.env.SERVER || 'ws://localhost:4343';
const ROOM = 'test-dash';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (c, l) => { console.log((c ? '✓ ' : '✗ ') + l); if (!c) failures++; };

function member(name, role = 'human') {
  return new Promise((resolve) => {
    const ws = new WebSocket(SERVER);
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === 'system' && m.text.includes('Bienvenue')) resolve(ws);
    });
    ws.on('open', () => ws.send(JSON.stringify({ type: 'register', name, role, room: ROOM })));
  });
}

// Tableau de bord : se connecte en `watch` et collecte ce qu'il reçoit.
function watcher(name) {
  return new Promise((resolve) => {
    const ws = new WebSocket(SERVER);
    const inbox = { snapshot: null, rosters: [], chat: [] };
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === 'snapshot') { inbox.snapshot = m; resolve({ ws, inbox }); }
      else if (m.type === 'roster') inbox.rosters.push(m.members);
      else if (m.type === 'chat-event') inbox.chat.push(m);
    });
    ws.on('open', () => ws.send(JSON.stringify({ type: 'watch', room: ROOM, name })));
  });
}

function tool(cmd, from, args = []) {
  const res = spawnSync(process.execPath, ['gt-tool.js', cmd, ...args], {
    env: { ...process.env, GT_SERVER: SERVER, GT_ROOM: ROOM, GT_NAME: from },
    encoding: 'utf8',
  });
  return (res.stdout || '') + (res.stderr || '');
}

async function run() {
  console.log('Test tableau de bord (watch/roster/chat-event/who)');

  const alice = await member('alice');
  await wait(100);

  // Le dashboard s'abonne -> snapshot avec alice dans le roster
  const dash = await watcher('panneau');
  check(dash.inbox.snapshot && Array.isArray(dash.inbox.snapshot.roster), 'snapshot reçu à l\'abonnement');
  check(dash.inbox.snapshot.roster.some((m) => m.name === 'alice'), 'snapshot contient le roster (alice)');

  // bob rejoint -> le dashboard reçoit un roster mis à jour incluant bob
  const bob = await member('bob', 'ai');
  await wait(200);
  const lastRoster = dash.inbox.rosters[dash.inbox.rosters.length - 1] || [];
  check(lastRoster.some((m) => m.name === 'bob' && m.role === 'ai'), 'roster poussé au join (bob ai)');

  // un say -> chat-event poussé au dashboard
  tool('say', 'alice', ['--to', 'bob', 'coucou', 'le', 'bot']);
  await wait(250);
  check(dash.inbox.chat.some((e) => e.from === 'alice' && e.text === 'coucou le bot'), 'chat-event poussé au dashboard');

  // who -> liste les membres avec leur état
  const whoOut = tool('who', 'alice');
  check(whoOut.includes('alice') && whoOut.includes('bob'), 'who liste les membres');
  check(/live|idle/.test(whoOut), 'who indique l\'état (live/idle)');

  // départ d'un membre -> roster mis à jour
  bob.close();
  await wait(200);
  const afterLeave = dash.inbox.rosters[dash.inbox.rosters.length - 1] || [];
  check(!afterLeave.some((m) => m.name === 'bob'), 'roster mis à jour au départ');

  alice.close();
  dash.ws.close();
  console.log(failures === 0 ? '\nTableau de bord OK.' : `\n${failures} échec(s).`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error('Erreur test :', e); process.exit(1); });
