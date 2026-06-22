const WebSocket = require('ws');
const { Terminal } = require('@xterm/headless');

const PORT = process.env.PORT || 4242;
const MAX_CHAT_HISTORY = 200;
const SCROLLBACK = 2000;

const wss = new WebSocket.Server({ port: PORT });

// Sortie propre si le port est déjà pris : évite d'empiler des relais zombies
// (sinon un ancien relais reste actif et tout le monde se branche dessus).
wss.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} déjà utilisé : un serveur GroupTerm tourne déjà. J'arrête celui-ci.`);
    process.exit(1);
  }
  console.error('Erreur serveur :', err.message);
});

// clients : ws => { name, role, room, term, lastActivity }
const clients = new Map();

// watchers (tableaux de bord) : ws => { room, name } ou { scope:'all', name }
// Connexions qui veulent recevoir en direct la présence + le chat, sans être des
// membres (pas de terminal diffusé). Scope 'all' = le hub web : toutes les rooms.
const watchers = new Map();

// rooms : roomName => { chat: [{from, role, text, time}] }
const rooms = new Map();

// Au-delà de ce délai sans sortie terminal, un membre est considéré "idle".
const LIVE_WINDOW_MS = 8000;

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
  broadcastChatEvent(room, entry);
  return entry;
}

// === Présence : pousser le roster + le chat aux tableaux de bord (watchers) ===

// Liste des membres d'une room, prête à l'envoi (présence calculée côté client
// à partir de lastActivity).
function rosterOf(room) {
  return roomMembers(room).map((m) => ({
    name: m.name,
    role: m.role,
    lastActivity: m.lastActivity || 0,
  }));
}

// Watchers concernés par une room : ceux abonnés à cette room + ceux en scope 'all'.
function watchersOf(room) {
  const out = [];
  for (const [ws, w] of watchers) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    if (w.scope === 'all' || w.room === room) out.push(ws);
  }
  return out;
}

function broadcastRoster(room) {
  const members = rosterOf(room);
  for (const ws of watchersOf(room)) send(ws, { type: 'roster', room, members });
}

function broadcastChatEvent(room, entry) {
  for (const ws of watchersOf(room)) send(ws, { type: 'chat-event', room, ...entry });
}

// Rooms "actives" : celles avec au moins un membre, ou avec un historique de chat.
function activeRooms() {
  const set = new Set();
  for (const m of clients.values()) set.add(m.room);
  for (const [name, data] of rooms) if (data.chat.length) set.add(name);
  return Array.from(set);
}

// Instantané de toutes les rooms (pour le hub web) — chat tronqué.
function roomsSnapshot(chatLimit = 50) {
  return activeRooms().map((room) => ({
    room,
    roster: rosterOf(room),
    chat: getRoom(room).chat.slice(-chatLimit),
  }));
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

  if (cmd === 'quit') {
    const target = msg.target ? String(msg.target).slice(0, 32) : null;
    if (!target) return send(ws, { type: 'tool-result', cmd, ok: false, text: '[quit] cible manquante.' });
    const found = findClientByName(room, target);
    if (!found) return send(ws, { type: 'tool-result', cmd, ok: false, text: `[quit] "${target}" introuvable dans #${room}.` });
    send(found.ws, { type: 'quit' });
    return send(ws, { type: 'tool-result', cmd, ok: true, text: `[quit] ordre envoyé à ${target} (#${room}).` });
  }

  if (cmd === 'who') {
    const members = roomMembers(room);
    if (members.length === 0) return send(ws, { type: 'tool-result', cmd, ok: true, text: `[who] Personne dans #${room}.` });
    const now = Date.now();
    const lines = members.map((m) => {
      const live = now - (m.lastActivity || 0) < LIVE_WINDOW_MS ? 'live' : 'idle';
      return `  ${m.name} (${m.role}) — ${live}`;
    });
    return send(ws, { type: 'tool-result', cmd, ok: true, text: `===== #${room} =====\n${lines.join('\n')}` });
  }

  return send(ws, { type: 'tool-result', cmd, ok: false, text: `[outil] commande inconnue : ${cmd}` });
}

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'tool') { handleTool(ws, msg); return; }

    // Tableau de bord : s'abonne à la présence + au chat.
    if (msg.type === 'watch') {
      const name = String(msg.name || 'dash').slice(0, 32);
      // Hub web : scope 'all' = toutes les rooms d'un coup.
      if (msg.scope === 'all') {
        watchers.set(ws, { scope: 'all', name });
        send(ws, { type: 'rooms-snapshot', rooms: roomsSnapshot() });
        console.log(`[~] hub ${name} observe toutes les rooms`);
        return;
      }
      // TUI gt-dash : une seule room.
      const room = String(msg.room || 'default').slice(0, 32);
      watchers.set(ws, { room, name });
      const roomData = getRoom(room);
      send(ws, { type: 'snapshot', room, roster: rosterOf(room), chat: roomData.chat });
      console.log(`[~] tableau de bord ${name} observe #${room}`);
      return;
    }

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
      clients.set(ws, { name, role, room, term: newTerm(cols, rows), lastActivity: Date.now() });
      send(ws, { type: 'system', text: `Bienvenue, ${name} (${role}) dans #${room}.` });

      const members = roomMembers(room).map((c) => `${c.name} (${c.role})`).join(', ');
      send(ws, { type: 'system', text: `Connectés : ${members}` });

      systemBroadcast(room, `${name} (${role}) a rejoint #${room}.`, ws);
      broadcastRoster(room);
      console.log(`[+] ${name} (${role}) rejoint #${room} (${wss.clients.size} connexion(s))`);
      return;
    }

    if (!meta) return;
    const room = meta.room;

    // Flux du terminal -> alimente l'émulateur (peek rend un écran propre)
    if (msg.type === 'terminal') {
      try { meta.term.write(String(msg.data || '')); } catch {}
      meta.lastActivity = Date.now();
      return;
    }

    if (msg.type === 'resize') {
      const cols = clamp(msg.cols, 20, 300, 120);
      const rows = clamp(msg.rows, 5, 100, 40);
      try { meta.term.resize(cols, rows); } catch {}
      broadcastRoster(room);
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
    if (watchers.has(ws)) { watchers.delete(ws); return; }
    const meta = clients.get(ws);
    clients.delete(ws);
    if (meta) {
      systemBroadcast(meta.room, `${meta.name} (${meta.role}) a quitté #${meta.room}.`);
      broadcastRoster(meta.room);
      console.log(`[-] ${meta.name} quitte #${meta.room}`);
    }
  });

  ws.on('error', (err) => console.error('Erreur WebSocket :', err.message));
});

// Rafraîchit périodiquement les tableaux de bord pour que les bascules
// live <-> idle apparaissent même sans nouvelle activité. .unref() : ne
// retient pas le process (utile pour les tests qui ferment le serveur).
const rosterTick = setInterval(() => {
  if (watchers.size === 0) return;
  const hasGlobal = Array.from(watchers.values()).some((w) => w.scope === 'all');
  const seen = new Set();
  const target = hasGlobal ? activeRooms() : Array.from(watchers.values()).map((w) => w.room).filter(Boolean);
  for (const room of target) {
    if (!seen.has(room)) { seen.add(room); broadcastRoster(room); }
  }
}, 3000);
rosterTick.unref();

console.log(`Serveur group-terminal démarré sur ws://localhost:${PORT}`);
