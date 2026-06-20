const WebSocket = require('ws');

const PORT = process.env.PORT || 4242;
const MAX_BUFFER_LINES = 500;
const MAX_CHAT_HISTORY = 100;
const MAX_TERMINAL_HISTORY = 50;

const wss = new WebSocket.Server({ port: PORT });

// clients : ws => { name, role, room }
const clients = new Map();

// rooms : roomName => { chat: [...], terminals: [{from, role, data, time}] }
const rooms = new Map();

function getRoom(name) {
  if (!rooms.has(name)) {
    rooms.set(name, { chat: [], terminals: [] });
  }
  return rooms.get(name);
}

function broadcast(room, sender, message) {
  const payload = JSON.stringify(message);
  for (const [client, meta] of clients) {
    if (client !== sender && meta.room === room && client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

function send(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function systemBroadcast(room, text, exclude = null) {
  const payload = JSON.stringify({ type: 'system', text });
  for (const [client, meta] of clients) {
    if (client !== exclude && meta.room === room && client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

function findClientByName(room, name) {
  for (const [, meta] of clients) {
    if (meta.room === room && meta.name === name) return meta;
  }
  return null;
}

function roomMembers(room) {
  return Array.from(clients.values()).filter(m => m.room === room);
}

wss.on('connection', (ws) => {
  console.log(`[+] Nouvelle connexion (${wss.clients.size} connecté(s))`);

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    const meta = clients.get(ws);

    if (msg.type === 'register') {
      const name = String(msg.name || 'anonyme').slice(0, 32);
      const role = msg.role === 'ai' ? 'ai' : 'human';
      const room = String(msg.room || 'default').slice(0, 32);

      // Vérifie les doublons dans la room
      if (findClientByName(room, name)) {
        send(ws, { type: 'system', text: `Le nom "${name}" est déjà pris dans la room "${room}".` });
        ws.close();
        return;
      }

      const roomData = getRoom(room);
      clients.set(ws, { name, role, room, buffer: [] });

      // Envoie l'historique
      send(ws, { type: 'system', text: `Bienvenue, ${name} (${role}) dans #${room}.` });
      if (roomData.chat.length > 0) {
        send(ws, { type: 'history', kind: 'chat', items: roomData.chat });
      }
      if (roomData.terminals.length > 0) {
        send(ws, { type: 'history', kind: 'terminal', items: roomData.terminals });
      }

      // Liste des connectés
      const members = roomMembers(room).map(c => `${c.name} (${c.role})`).join(', ');
      send(ws, { type: 'system', text: `Connectés : ${members}` });

      systemBroadcast(room, `${name} (${role}) a rejoint #${room}.`, ws);
      console.log(`[+] ${name} (${role}) rejoint #${room}`);
      return;
    }

    if (!meta) return;
    const room = meta.room;
    const roomData = getRoom(room);

    if (msg.type === 'chat') {
      const text = String(msg.text || '').slice(0, 2000);
      const entry = { type: 'chat', from: meta.name, role: meta.role, text, time: Date.now() };
      roomData.chat.push(entry);
      if (roomData.chat.length > MAX_CHAT_HISTORY) roomData.chat.shift();
      broadcast(room, ws, entry);
    }

    if (msg.type === 'terminal') {
      const data = String(msg.data || '');
      // Stocke le buffer ligne par ligne pour les /peek
      const lines = data.split('\n');
      for (const line of lines) {
        meta.buffer.push(line);
        if (meta.buffer.length > MAX_BUFFER_LINES) meta.buffer.shift();
      }
      const entry = { type: 'terminal', from: meta.name, role: meta.role, data, time: Date.now() };
      roomData.terminals.push(entry);
      if (roomData.terminals.length > MAX_TERMINAL_HISTORY) roomData.terminals.shift();
      broadcast(room, ws, entry);
    }

    if (msg.type === 'peek') {
      const target = findClientByName(room, msg.target);
      if (!target) {
        send(ws, { type: 'peek-result', target: msg.target, found: false, buffer: '' });
      } else {
        const buffer = target.buffer.slice(-50).join('\n');
        send(ws, { type: 'peek-result', target: msg.target, found: true, buffer });
      }
    }

    if (msg.type === 'who') {
      const list = roomMembers(room).map(c => `${c.name} (${c.role})`).join(', ');
      send(ws, { type: 'system', text: `Connectés : ${list}` });
    }
  });

  ws.on('close', () => {
    const meta = clients.get(ws);
    clients.delete(ws);
    if (meta) {
      systemBroadcast(meta.room, `${meta.name} (${meta.role}) a quitté #${meta.room}.`);
      console.log(`[-] ${meta.name} quitte #${meta.room}`);
    }
    console.log(`[-] Déconnexion (${wss.clients.size} connecté(s))`);
  });

  ws.on('error', (err) => {
    console.error('Erreur WebSocket :', err.message);
  });
});

console.log(`Serveur group-terminal démarré sur ws://localhost:${PORT}`);
