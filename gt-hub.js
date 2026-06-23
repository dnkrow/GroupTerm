// gt-hub — centre de contrôle GroupTerm (page web + actions locales).
//
// Tourne sur TON PC. Il :
//   - sert la page du hub sur http://localhost:4243 (et ouvre ton navigateur par défaut) ;
//   - se connecte au serveur-relais pour l'état partagé de TOUTES les rooms
//     (présence + chat), via un abonnement `watch{scope:'all'}` ;
//   - exécute les actions locales que la page demande : ouvrir / fermer de vrais
//     terminaux gt.js sur cette machine.
//
// Pourquoi un composant local ? Une page web ne peut pas lancer de terminal sur ta
// machine (sandbox du navigateur). Le hub fait ce pont.
//
//   node gt-hub.js [nom]
//   (lit GT_SERVER, GT_NAME, GT_CWD, HUB_PORT dans l'environnement)

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const SERVER = process.env.GT_SERVER || process.env.SERVER || 'ws://localhost:4242';
const NAME = process.env.GT_NAME || process.argv[2] || 'moi';
const CWD = process.env.GT_CWD || os.homedir();
const HUB_PORT = parseInt(process.env.HUB_PORT, 10) || 4243;
const GT = path.join(__dirname, 'gt.js');
const PUB = path.join(__dirname, 'public');

// --- État partagé (pour servir aussi les onglets qui se (re)connectent) ---
const roomsState = new Map();   // room => { roster:[], chat:[] }
const browsers = new Set();     // sockets navigateur
const launched = [];            // terminaux lancés par CE hub : [{room, name, role}]
let relay = null;
let relayConnected = false;
let activePeek = null;          // { room, target }
let peekTimer = null;

// =============== Serveur HTTP local (sert public/) ===============
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};
const httpServer = http.createServer((req, res) => {
  let rel = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const full = path.join(PUB, path.normalize(rel).replace(/^([\\/]|\.\.)+/, ''));
  if (!full.startsWith(PUB)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(data);
  });
});

// =============== WebSocket navigateur ↔ hub ===============
const wss = new WebSocket.Server({ server: httpServer });

function toBrowsers(msg) {
  const s = JSON.stringify(msg);
  for (const b of browsers) if (b.readyState === WebSocket.OPEN) b.send(s);
}
function snapshotForBrowser() {
  return { type: 'rooms-snapshot', rooms: Array.from(roomsState, ([room, v]) => ({ room, roster: v.roster, chat: v.chat })) };
}
// Liste des terminaux lancés par ce hub (pour le pied de page "Mes terminaux").
function sendMyTerms() { toBrowsers({ type: 'my-terms', terms: launched.slice() }); }

wss.on('connection', (b) => {
  browsers.add(b);
  b.send(JSON.stringify({ type: 'hello', name: NAME, server: SERVER, connected: relayConnected }));
  b.send(JSON.stringify(snapshotForBrowser()));
  b.send(JSON.stringify({ type: 'my-terms', terms: launched.slice() }));
  b.on('message', (raw) => { let m; try { m = JSON.parse(raw.toString()); } catch { return; } handleBrowser(m); });
  b.on('close', () => { browsers.delete(b); if (browsers.size === 0) stopPeek(); });
});

function handleBrowser(m) {
  if (m.cmd === 'say') {
    const o = { type: 'tool', cmd: 'say', room: m.room, from: NAME, text: String(m.text || '') };
    if (m.target) o.target = m.target;
    if (m.all) o.all = true;
    relaySend(o);
  } else if (m.cmd === 'peek') {
    startPeek(m.room, m.target);
  } else if (m.cmd === 'peek-stop') {
    stopPeek();
  } else if (m.cmd === 'open-terminal') {
    openTerminal(m.room, m.name, m.role);
  } else if (m.cmd === 'close-terminal') {
    const target = String(m.name || NAME).slice(0, 32);
    relaySend({ type: 'tool', cmd: 'quit', room: m.room, from: NAME, target });
    const i = launched.findIndex((t) => t.room === m.room && t.name === target);
    if (i >= 0) { launched.splice(i, 1); sendMyTerms(); }
  }
}

// =============== Peek live (poll côté relais) ===============
function startPeek(room, target) {
  stopPeek();
  activePeek = { room, target };
  const poll = () => relaySend({ type: 'tool', cmd: 'peek', room, from: NAME, target, n: 80 });
  poll();
  peekTimer = setInterval(poll, 1500);
}
function stopPeek() {
  if (peekTimer) clearInterval(peekTimer);
  peekTimer = null;
  activePeek = null;
}

// =============== Connexion au serveur-relais ===============
function relaySend(o) { if (relay && relay.readyState === WebSocket.OPEN) relay.send(JSON.stringify(o)); }

function connectRelay() {
  relay = new WebSocket(SERVER);
  relay.on('open', () => {
    relayConnected = true;
    relaySend({ type: 'watch', scope: 'all', name: NAME });
    toBrowsers({ type: 'relay', connected: true });
  });
  relay.on('message', (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.type === 'rooms-snapshot') {
      roomsState.clear();
      for (const r of m.rooms) roomsState.set(r.room, { roster: r.roster || [], chat: r.chat || [] });
      toBrowsers(m);
    } else if (m.type === 'roster') {
      const s = roomsState.get(m.room) || { roster: [], chat: [] };
      s.roster = m.members || [];
      roomsState.set(m.room, s);
      toBrowsers(m);
    } else if (m.type === 'chat-event') {
      const s = roomsState.get(m.room) || { roster: [], chat: [] };
      s.chat.push({ from: m.from, role: m.role, text: m.text, time: m.time });
      if (s.chat.length > 200) s.chat.shift();
      roomsState.set(m.room, s);
      toBrowsers(m);
    } else if (m.type === 'tool-result' && m.cmd === 'peek') {
      if (activePeek) toBrowsers({ type: 'peek', room: activePeek.room, target: m.target || activePeek.target, ok: m.ok, text: m.text });
    }
  });
  relay.on('close', () => { relayConnected = false; toBrowsers({ type: 'relay', connected: false }); setTimeout(connectRelay, 2000); });
  relay.on('error', () => {});
}

// =============== Actions locales (ouvrir / le navigateur) ===============
// Ouvre un vrai terminal gt.js sur cette machine. `name` permet d'ouvrir
// PLUSIEURS terminaux distincts dans une même room (ex. deux Claude en solo :
// claude-a et claude-b dans #solo) ; sans nom, on retombe sur le nom du hub.
function openTerminal(room, name, role) {
  room = String(room || 'default').slice(0, 32).replace(/[^\w.\-]/g, '');
  name = String(name || NAME).slice(0, 32).replace(/[^\w.\-]/g, '') || NAME;
  role = role === 'ai' ? 'ai' : 'human';
  if (!room) return;
  const env = { ...process.env, GT_SERVER: SERVER, GT_NAME: name, GT_ROOM: room, GT_ROLE: role };
  try {
    if (process.platform === 'win32') {
      // /c : quand node s'arrête (fermeture demandée), la fenêtre se referme.
      spawn(`start "GroupTerm ${name} #${room}" cmd /c node "${GT}" ${name} ${room} ${role}`, { shell: true, cwd: CWD, env, detached: true, stdio: 'ignore' });
    } else if (process.platform === 'darwin') {
      const script = `tell application "Terminal" to do script "cd '${CWD}' && GT_SERVER='${SERVER}' GT_NAME='${name}' GT_ROLE='${role}' node '${GT}' ${name} ${room} ${role}"`;
      spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore' });
    } else {
      spawn('x-terminal-emulator', ['-e', `node ${GT} ${name} ${room} ${role}`], { cwd: CWD, env, detached: true, stdio: 'ignore' });
    }
  } catch (e) { console.error('[hub] ouverture terminal :', e.message); }
  if (!launched.some((t) => t.room === room && t.name === name)) {
    launched.push({ room, name, role });
    sendMyTerms();
  }
}

function openBrowser(url) {
  try {
    if (process.platform === 'win32') spawn(`start "" "${url}"`, { shell: true, detached: true, stdio: 'ignore' });
    else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' });
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
  } catch {}
}

// =============== Démarrage ===============
httpServer.listen(HUB_PORT, '127.0.0.1', () => {
  const url = `http://localhost:${HUB_PORT}`;
  console.log(`Hub GroupTerm : ${url}  (${NAME} -> ${SERVER})`);
  if (!process.env.GT_NO_BROWSER) openBrowser(url);
});
connectRelay();
