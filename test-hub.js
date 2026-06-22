// Test des extensions "hub" côté relais : abonnement global (watch scope:'all'),
// rooms-snapshot, événements taggués par room, et contrôle `quit`.
// (Un serveur de test doit tourner sur SERVER.)
const WebSocket = require('ws');

const SERVER = process.env.SERVER || 'ws://localhost:4343';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (c, l) => { console.log((c ? '✓ ' : '✗ ') + l); if (!c) failures++; };

function member(name, room, role = 'human') {
  return new Promise((resolve) => {
    const ws = new WebSocket(SERVER);
    const inbox = { quit: false };
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === 'system' && m.text.includes('Bienvenue')) resolve({ ws, inbox });
      if (m.type === 'quit') inbox.quit = true;
    });
    ws.on('open', () => ws.send(JSON.stringify({ type: 'register', name, role, room })));
  });
}

// Hub : abonnement global + collecte.
function hub(name) {
  return new Promise((resolve) => {
    const ws = new WebSocket(SERVER);
    const inbox = { snapshot: null, rosters: [], chat: [], toolResults: [] };
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === 'rooms-snapshot') { inbox.snapshot = m; resolve({ ws, inbox }); }
      else if (m.type === 'roster') inbox.rosters.push(m);
      else if (m.type === 'chat-event') inbox.chat.push(m);
      else if (m.type === 'tool-result') inbox.toolResults.push(m);
    });
    ws.on('open', () => ws.send(JSON.stringify({ type: 'watch', scope: 'all', name })));
  });
}
const send = (ws, o) => ws.send(JSON.stringify(o));

async function run() {
  console.log('Test hub (watch-all / rooms-snapshot / quit)');

  const rA = 'hub-A', rB = 'hub-B';
  const alice = await member('alice', rA);
  const charlie = await member('charlie', rA, 'ai');
  await wait(120);

  // Abonnement global -> snapshot listant la room A avec ses 2 membres
  const h = await hub('hub1');
  const snapRooms = (h.inbox.snapshot.rooms || []).map((r) => r.room);
  check(snapRooms.includes(rA), 'rooms-snapshot liste les rooms actives (A)');
  const roomA = h.inbox.snapshot.rooms.find((r) => r.room === rA);
  check(roomA && roomA.roster.length === 2, 'le snapshot inclut le roster de la room');

  // bob rejoint une AUTRE room -> le hub global reçoit un roster taggué room B
  const bob = await member('bob', rB);
  await wait(200);
  check(h.inbox.rosters.some((r) => r.room === rB && r.members.some((m) => m.name === 'bob')), 'roster global taggué par room (B)');

  // say dans la room A -> chat-event taggué room A reçu par le hub global
  send(h.ws, { type: 'tool', cmd: 'say', room: rA, from: 'alice', target: 'charlie', text: 'ping' });
  await wait(200);
  check(h.inbox.chat.some((e) => e.room === rA && e.text === 'ping'), 'chat-event taggué par room reçu par le hub');

  // quit -> charlie reçoit l'ordre de fermeture
  send(h.ws, { type: 'tool', cmd: 'quit', room: rA, from: 'hub1', target: 'charlie' });
  await wait(200);
  check(charlie.inbox.quit === true, 'quit délivré au membre ciblé');
  check(h.inbox.toolResults.some((r) => r.cmd === 'quit' && r.ok), 'quit confirmé par tool-result');

  alice.ws.close(); bob.ws.close(); try { charlie.ws.close(); } catch {} h.ws.close();
  console.log(failures === 0 ? '\nHub OK.' : `\n${failures} échec(s).`);
  process.exit(failures === 0 ? 0 : 1);
}
run().catch((e) => { console.error('Erreur test :', e); process.exit(1); });
