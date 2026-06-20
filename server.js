const WebSocket = require('ws');
const { Terminal } = require('@xterm/headless');

const PORT = process.env.PORT || 4242;
const MAX_CHAT_HISTORY = 200;
const SCROLLBACK = 2000;

const wss = new WebSocket.Server({ port: PORT });

// clients : ws => { name, role, room, term }
const clients = new Map();

// rooms : roomName => { chat: [{from, role, text, time}] }
const rooms = new Map();

const clamp = (v, lo, hi, def) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
};

function newTerm(cols, rows) {
  return new Terminal({ cols, rows, scrollback: SCROLLBACK, allowProposedApi: true });
}

// Rend les N dernières lignes de l'écran émulé (scrollback + écran courant), propre.
function renderPeek(term, n) {
  const buf = term.buffer.active;
  const total = buf.length;
  const start = Math.max(0, total - n);
  const lines = [];
  for (let y = start; y < total; y++) {
    const line = buf.getLine(y);
    lines.push(line ? line.translateToString(true) : '');
  }
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

function getRoom(name) {
  if (!rooms.has(name)) rooms.set(name, { chat: [] });
  return rooms.get(name);
}

function send(ws, message) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

function systemBroadcast(room, text, exclude = null) {
  for (const [client, meta] of clients) {
    if (client !== exclude && meta.room === room && client.readyState === WebSocket.OPEN) {
      send(client, { type: 'system', text });
    }
  }
}

function findClientByName(room, name) {
  for (const [ws, meta] of clients) {
    if (meta.room === room && meta.name === name) return { ws, meta };
  }
  return null;
}

function roomMembers(room) {
  return Array.from(clients.values()).filter((m) => m.room === room);
}

function otherMembers(room, selfName) {
  const out = [];
  for (const [ws, meta] of clients) {
    if (meta.room === room && meta.name !== selfName) out.push({ ws, meta });
  }
  return out;
}

function pushTranscript(room, from, role, text) {
  const roomData = getRoom(room);
  const entry = { from, role: role || 'human', text, time: Date.now() };
  roomData.chat.push(entry);
  if (roomData.chat.length > MAX_CHAT_HISTORY) roomData.chat.shift();
  return entry;
}

// === Requêtes "outil" (peek/say/chat) — connexion éphémère, pas de membre ===
function handleTool(ws, msg) {
  const room = String(msg.room || 'default').slice(0, 32);
  const from = String(msg.from || 'anon').slice(0, 32);
  const cmd = msg.cmd;

  if (cmd === 'peek') {
    let target = msg.target ? String(msg.target).slice(0, 32) : null;
    if (!target) {
      const others = otherMembers(room, from);
      if (others.length === 0) return send(ws, { type: 'tool-result', cmd, ok: false, text: '[peek] Personne d\'autre dans la room.' });
      if (others.length > 1) {
        const names = others.map((o) => o.meta.name).join(', ');
        return send(ws, { type: 'tool-result', cmd, ok: false, text: `[peek] Plusieurs personnes : précise un nom (${names}). Ex: peek ${others[0].meta.name}` });
      }
      target = others[0].meta.name;
    }
    const found = findClientByName(room, target);
    if (!found) return send(ws, { type: 'tool-result', cmd, ok: false, text: `[peek] "${target}" introuvable dans #${room}.` });
    const n = clamp(msg.n, 1, SCROLLBACK, 40);
    const screen = renderPeek(found.meta.term, n);
    return send(ws, { type: 'tool-result', cmd, ok: true, target, text: `===== terminal de ${target} (#${room}) =====\n${screen}` });
  }

  if (cmd === 'say') {
    const text = String(msg.text || '').slice(0, 4000);
    if (!text.trim()) return send(ws, { type: 'tool-result', cmd, ok: false, text: '[say] usage : say <message>' });
    let targets;
    if (msg.target) {
      const found = findClientByName(room, String(msg.target).slice(0, 32));
      if (!found) return send(ws, { type: 'tool-result', cmd, ok: false, text: `[say] "${msg.target}" introuvable.` });
      targets = [found];
    } else {
      targets = otherMembers(room, from);
      if (targets.length === 0) return send(ws, { type: 'tool-result', cmd, ok: false, text: '[say] Personne d\'autre dans la room.' });
    }
    const selfMeta = findClientByName(room, from);
    pushTranscript(room, from, selfMeta ? selfMeta.meta.role : 'human', text);
    for (const t of targets) send(t.ws, { type: 'deliver', from, text });
    const names = targets.map((t) => t.meta.name).join(', ');
    return send(ws, { type: 'tool-result', cmd, ok: true, text: `[say -> ${names}] ${text}` });
  }

  if (cmd === 'chat') {
    const roomData = getRoom(room);
    const n = clamp(msg.n, 0, MAX_CHAT_HISTORY, roomData.chat.length);
    const items = roomData.chat.slice(-n);
    if (items.length === 0) return send(ws, { type: 'tool-result', cmd, ok: true, text: '[chat] Aucune conversation pour l\'instant.' });
    const lines = items.map((e) => `[${new Date(e.time).toLocaleTimeString()}] ${e.from}: ${e.text}`);
    return send(ws, { type: 'tool-result', cmd, ok: true, text: lines.join('\n') });
  }

  return send(ws, { type: 'tool-result', cmd, ok: false, text: `[outil] commande inconnue : ${cmd}` });
}

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'tool') { handleTool(ws, msg); return; }

    const meta = clients.get(ws);

    if (msg.type === 'register') {
      const name = String(msg.name || 'anonyme').slice(0, 32);
      const role = msg.role === 'ai' ? 'ai' : 'human';
      const room = String(msg.room || 'default').slice(0, 32);

      if (findClientByName(room, name)) {
        send(ws, { type: 'system', text: `Le nom "${name}" est déjà pris dans #${room}.` });
        ws.close();
        return;
      }

      const cols = clamp(msg.cols, 20, 300, 120);
      const rows = clamp(msg.rows, 5, 100, 40);
      clients.set(ws, { name, role, room, term: newTerm(cols, rows) });
      send(ws, { type: 'system', text: `Bienvenue, ${name} (${role}) dans #${room}.` });

      const members = roomMembers(room).map((c) => `${c.name} (${c.role})`).join(', ');
      send(ws, { type: 'system', text: `Connectés : ${members}` });

      systemBroadcast(room, `${name} (${role}) a rejoint #${room}.`, ws);
      console.log(`[+] ${name} (${role}) rejoint #${room} (${wss.clients.size} connexion(s))`);
      return;
    }

    if (!meta) return;
    const room = meta.room;

    // Flux du terminal -> alimente l'émulateur (peek rend un écran propre)
    if (msg.type === 'terminal') {
      try { meta.term.write(String(msg.data || '')); } catch {}
      return;
    }

    if (msg.type === 'resize') {
      const cols = clamp(msg.cols, 20, 300, 120);
      const rows = clamp(msg.rows, 5, 100, 40);
      try { meta.term.resize(cols, rows); } catch {}
      return;
    }

    // Compat : commandes via le protocole membre (anciens clients)
    if (msg.type === 'peek') { handleTool(ws, { cmd: 'peek', room, from: meta.name, target: msg.target }); return; }
    if (msg.type === 'chat') {
      pushTranscript(room, meta.name, meta.role, String(msg.text || '').slice(0, 4000));
      for (const o of otherMembers(room, meta.name)) send(o.ws, { type: 'deliver', from: meta.name, text: msg.text });
      return;
    }
    if (msg.type === 'who') {
      const list = roomMembers(room).map((c) => `${c.name} (${c.role})`).join(', ');
      send(ws, { type: 'system', text: `Connectés : ${list}` });
      return;
    }
  });

  ws.on('close', () => {
    const meta = clients.get(ws);
    clients.delete(ws);
    if (meta) {
      systemBroadcast(meta.room, `${meta.name} (${meta.role}) a quitté #${meta.room}.`);
      console.log(`[-] ${meta.name} quitte #${meta.room}`);
    }
  });

  ws.on('error', (err) => console.error('Erreur WebSocket :', err.message));
});

console.log(`Serveur group-terminal démarré sur ws://localhost:${PORT}`);
