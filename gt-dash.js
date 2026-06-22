// gt-dash — tableau de bord live de GroupTerm (panneau séparé).
//
// S'ouvre À CÔTÉ du terminal partagé (gt.js) : il ne touche pas au shell, il se
// contente d'observer la room via le serveur. Affiche :
//   - en haut : qui est dans la room, en temps réel (● vert = actif, ● gris = idle),
//     avec le rôle (human / ai) ;
//   - au milieu : le fil de discussion (say/chat) qui se met à jour tout seul ;
//   - en bas : une ligne "say>" pour écrire un message sans quitter le dashboard.
//
//   node gt-dash.js [nom] [room]
//   (lit aussi GT_SERVER / GT_ROOM / GT_NAME comme les commandes peek/say/chat)
//
// Astuce : "@bob message" cible bob ; "message" parle à tout le monde. Ctrl+C pour quitter.

const WebSocket = require('ws');

const SERVER = process.env.GT_SERVER || process.env.SERVER || 'ws://localhost:4242';
const ROOM = process.env.GT_ROOM || process.argv[3] || 'default';
const NAME = process.env.GT_NAME || process.argv[2] || 'dash';
const LIVE_WINDOW_MS = 8000; // doit correspondre au serveur

// --- État ---
let roster = [];        // [{name, role, lastActivity}]
let chat = [];          // [{from, role, text, time}]
let input = '';         // ligne de saisie en cours
let connected = false;
let ws = null;
const MAX_CHAT = 500;

// --- Petits utilitaires ANSI ---
const ESC = '\x1b';
const DIM = `${ESC}[2m`, BOLD = `${ESC}[1m`, RESET = `${ESC}[0m`;
const GREEN = `${ESC}[32m`, GREY = `${ESC}[90m`, CYAN = `${ESC}[36m`, RED = `${ESC}[31m`;

// Longueur "visible" (en ignorant les séquences d'échappement).
function visLen(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === ESC) { while (i < s.length && s[i] !== 'm') i++; continue; }
    n++;
  }
  return n;
}

// Tronque à w caractères visibles (préserve les couleurs, ajoute un reset).
function visSlice(s, w) {
  let out = '', vis = 0;
  for (let i = 0; i < s.length && vis < w; i++) {
    if (s[i] === ESC) { let j = i + 1; while (j < s.length && s[j] !== 'm') j++; out += s.slice(i, j + 1); i = j; continue; }
    out += s[i]; vis++;
  }
  return out + RESET;
}

function hardWrap(s, w) {
  if (w < 1) w = 1;
  const out = [];
  for (let i = 0; i < s.length; i += w) out.push(s.slice(i, i + w));
  return out.length ? out : [''];
}

const isLive = (m) => Date.now() - (m.lastActivity || 0) < LIVE_WINDOW_MS;
const hhmm = (t) => new Date(t).toTimeString().slice(0, 5);

// Découpe une entrée de chat en lignes colorées tenant dans `width`.
function entryLines(e, width) {
  const head = `[${hhmm(e.time)}] ${e.from}: `;
  const nameColor = e.role === 'ai' ? CYAN : BOLD;
  const headColored = `${DIM}[${hhmm(e.time)}]${RESET} ${nameColor}${e.from}${RESET}: `;
  const raw = hardWrap(head + (e.text || ''), width);
  return raw.map((ln, i) =>
    i === 0 ? headColored + ln.slice(head.length) : `${DIM}${ln}${RESET}`
  );
}

// --- Rendu complet ---
function render() {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  const lines = [];

  // 1) En-tête
  const state = connected ? `${DIM}${roster.length} connecté(s)${RESET}` : `${RED}(déconnecté…)${RESET}`;
  lines.push(visSlice(`${BOLD}#${ROOM}${RESET}  ${state}`, cols));

  // 2) Roster
  const dots = roster.map((m) => {
    const dot = isLive(m) ? `${GREEN}●${RESET}` : `${GREY}●${RESET}`;
    const nm = m.role === 'ai' ? `${CYAN}${m.name}${RESET}` : m.name;
    return `${dot} ${nm}${DIM}(${m.role})${RESET}`;
  }).join('   ');
  lines.push(visSlice(dots || `${DIM}(personne pour l'instant)${RESET}`, cols));

  // 3) Séparateur
  lines.push(`${DIM}${'─'.repeat(cols)}${RESET}`);

  // 4) Fil de chat (les dernières lignes qui tiennent)
  const chatHeight = Math.max(1, rows - 5);
  let clines = [];
  for (const e of chat) clines.push(...entryLines(e, cols));
  if (clines.length === 0) clines = [`${DIM}(aucun message — écris ci-dessous)${RESET}`];
  clines = clines.slice(-chatHeight);
  while (clines.length < chatHeight) clines.push('');
  lines.push(...clines);

  // 5) Séparateur + saisie
  lines.push(`${DIM}${'─'.repeat(cols)}${RESET}`);
  const avail = Math.max(1, cols - 6);
  const shown = input.length > avail ? input.slice(input.length - avail) : input;
  lines.push(`${BOLD}say>${RESET} ${shown}`);

  // Écriture en un bloc (chaque ligne nettoyée jusqu'au bord)
  let frame = `${ESC}[H` + lines.map((l) => l + `${ESC}[K`).join('\r\n') + `${ESC}[J`;
  process.stdout.write(frame);
  // Curseur en bout de saisie
  process.stdout.write(`${ESC}[${rows};${6 + shown.length}H`);
}

// --- Connexion / abonnement ---
function connect() {
  ws = new WebSocket(SERVER);
  ws.on('open', () => {
    connected = true;
    ws.send(JSON.stringify({ type: 'watch', room: ROOM, name: NAME }));
    render();
  });
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === 'snapshot') {
      roster = msg.roster || [];
      chat = (msg.chat || []).slice(-MAX_CHAT);
    } else if (msg.type === 'roster') {
      roster = msg.members || [];
    } else if (msg.type === 'chat-event') {
      chat.push({ from: msg.from, role: msg.role, text: msg.text, time: msg.time });
      if (chat.length > MAX_CHAT) chat.shift();
    } else {
      return; // (system, etc.) — ignoré
    }
    render();
  });
  ws.on('close', () => { connected = false; render(); setTimeout(connect, 2000); });
  ws.on('error', () => {});
}

// --- Envoi d'un message depuis la ligne "say>" ---
function submit() {
  const line = input.trim();
  input = '';
  if (!line) { render(); return; }
  let text = line, target = null;
  const m = line.match(/^@(\S+)\s+([\s\S]+)$/);
  if (m) { target = m[1]; text = m[2]; }
  if (ws && ws.readyState === WebSocket.OPEN) {
    const req = { type: 'tool', cmd: 'say', room: ROOM, from: NAME, text };
    if (target) req.target = target;
    ws.send(JSON.stringify(req));
  }
  render(); // l'écho revient via chat-event
}

// --- Entrées clavier ---
function quit() {
  try { if (process.stdin.isTTY) process.stdin.setRawMode(false); } catch {}
  process.stdout.write(`${ESC}[?25h${ESC}[?1049l`); // curseur visible + écran restauré
  process.exit(0);
}

if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on('data', (d) => {
  for (const ch of d.toString('utf8')) {
    if (ch === '\x03') return quit();              // Ctrl+C
    if (ch === '\r' || ch === '\n') { submit(); continue; }
    if (ch === '\x7f' || ch === '\x08') { input = input.slice(0, -1); continue; } // Backspace
    if (ch >= ' ') input += ch;                    // caractère imprimable
  }
  render();
});

process.stdout.on('resize', render);
setInterval(render, 1000).unref(); // rafraîchit les bascules live/idle
process.on('exit', () => { try { process.stdout.write(`${ESC}[?25h${ESC}[?1049l`); } catch {} });

// Écran alternatif (laisse ton terminal intact à la sortie)
process.stdout.write(`${ESC}[?1049h${ESC}[2J${ESC}[H`);
render();
connect();
