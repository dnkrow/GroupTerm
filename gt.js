// group-terminal — wrapper de shell partagé (modèle inspiré de DuoTerm).
//
// Lance TON shell normal en passthrough transparent (rendu natif, aucun re-dessin),
// diffuse sa sortie au serveur pour que les autres puissent faire `peek`, et injecte
// les commandes `peek` / `say` / `chat` dans le PATH (donc dispo pour toi ET pour ton
// IA tournant dans ce shell). Les messages `say` venus des autres sont injectés dans
// ton terminal via un collage entre crochets (bracketed paste) qui réveille l'IA.
//
//   node gt.js <nom> <room> [role]
//   ex:  node gt.js alice notre-projet
//        node gt.js alice-bot notre-projet ai

const WebSocket = require('ws');
const pty = require('node-pty');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVER = process.env.GT_SERVER || process.env.SERVER || 'ws://localhost:4242';
const NAME = process.env.GT_NAME || process.argv[2] || 'anonyme';
const ROOM = process.env.GT_ROOM || process.argv[3] || 'default';
const ROLE = process.env.GT_ROLE || process.argv[4] || 'human';
const SHELL = process.platform === 'win32' ? 'powershell.exe' : process.platform === 'darwin' ? 'zsh' : 'bash';

// --- Génère les commandes peek/say/chat dans un dossier ajouté au PATH ---
const RUNTIME_BIN = path.join(os.tmpdir(), 'groupterm', 'bin');
fs.mkdirSync(RUNTIME_BIN, { recursive: true });

// Chemin du script outil, en slashes avant (accepté par node sous Windows et bash)
const TOOL = path.join(__dirname, 'gt-tool.js').replace(/\\/g, '/');

function writeShims() {
  for (const cmd of ['peek', 'say', 'chat', 'who']) {
    // Variante cmd.exe / PowerShell
    fs.writeFileSync(
      path.join(RUNTIME_BIN, `${cmd}.cmd`),
      ['@echo off', `node "${TOOL}" ${cmd} %*`].join('\r\n'),
      'ascii'
    );
    // Variante bash (Git Bash / WSL) — exécutable sans extension
    fs.writeFileSync(
      path.join(RUNTIME_BIN, cmd),
      ['#!/usr/bin/env bash', `node "${TOOL}" ${cmd} "$@"`, ''].join('\n'),
      { encoding: 'utf8', mode: 0o755 }
    );
  }
}
writeShims();

// --- Environnement du shell : contexte + PATH avec nos commandes ---
const env = { ...process.env, GT_SERVER: SERVER, GT_ROOM: ROOM, GT_NAME: NAME, GT_ROLE: ROLE };
const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'PATH';
env[pathKey] = RUNTIME_BIN + path.delimiter + (env[pathKey] || '');

// --- Lance le shell dans un pseudo-terminal ---
const shell = pty.spawn(SHELL, [], {
  name: 'xterm-256color',
  cols: process.stdout.columns || 80,
  rows: process.stdout.rows || 24,
  cwd: process.cwd(),
  env,
});

// --- Connexion au serveur (diffusion de la sortie + réception des say) ---
let ws;
let outBuffer = '';
let flushTimer = null;

function flush() {
  if (outBuffer && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'terminal', data: outBuffer }));
    outBuffer = '';
  }
}

// File d'attente : sérialise les injections pour ne pas mélanger deux messages.
let deliverChain = Promise.resolve();
function injectPaste(text) {
  return new Promise((resolve) => {
    // Préfixe chaque ligne par "# " : si aucune IA ne tourne et que le message
    // atterrit à un simple prompt (PowerShell/bash), c'est une ligne de commentaire
    // → Entrée n'exécute rien, pas d'erreur. Claude Code, lui, le lit normalement.
    // (Le "#" est ajouté seulement ici, à l'injection ; l'historique du chat reste propre.)
    const commented = text.split(/\r\n|\r|\n/).map((l) => '# ' + l).join('\n');
    // Collage entre crochets : insertion atomique reconnue par les TUI (Claude Code…)
    shell.write('\x1b[200~' + commented + '\x1b[201~');
    setTimeout(() => {
      shell.write('\r');
      setTimeout(resolve, 150);
    }, 120);
  });
}

function connect() {
  ws = new WebSocket(SERVER);
  ws.on('open', () => ws.send(JSON.stringify({
    type: 'register', name: NAME, role: ROLE, room: ROOM,
    cols: process.stdout.columns || 80, rows: process.stdout.rows || 24,
  })));
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === 'deliver') {
      deliverChain = deliverChain.then(() => injectPaste(msg.text)).catch(() => {});
    } else if (msg.type === 'quit') {
      // Fermeture demandée depuis le hub web : on coupe le shell et on sort.
      try { shell.kill(); } catch {}
      cleanup();
      process.exit(0);
    }
    // Les autres types (system, etc.) sont ignorés : le shell reste propre.
  });
  ws.on('close', () => setTimeout(connect, 2000));
  ws.on('error', () => {});
}
connect();

// --- Passthrough : sortie du shell -> écran + serveur ---
shell.onData((data) => {
  process.stdout.write(data);
  outBuffer += data;
  if (flushTimer) clearTimeout(flushTimer);
  if (outBuffer.length > 800 || data.includes('\n') || data.includes('\r')) flush();
  else flushTimer = setTimeout(flush, 150);
});

shell.onExit(() => {
  cleanup();
  process.exit(0);
});

// --- Passthrough : clavier -> shell ---
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on('data', (d) => shell.write(d));

process.stdout.on('resize', () => {
  try { shell.resize(process.stdout.columns, process.stdout.rows); } catch {}
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'resize', cols: process.stdout.columns, rows: process.stdout.rows }));
  }
});

function cleanup() {
  try { if (process.stdin.isTTY) process.stdin.setRawMode(false); } catch {}
  try { flush(); } catch {}
}
process.on('exit', cleanup);
process.on('SIGINT', () => {}); // Ctrl+C est transmis au shell, pas au wrapper

// Petit rappel avant que le shell ne prenne la main
process.stdout.write(
  `\x1b[2m[group-terminal] ${NAME} @ #${ROOM} — commandes: peek · say "msg" · chat · who` +
  `  (tableau de bord live: node gt-dash.js)\x1b[0m\r\n`
);
