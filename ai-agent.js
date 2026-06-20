const WebSocket = require('ws');
const { exec } = require('child_process');
const chalk = require('chalk');

const SERVER = process.env.SERVER || 'ws://localhost:4242';
const NAME = process.env.NAME || process.argv[2] || 'assistant';
const ROOM = process.env.ROOM || process.argv[3] || 'default';
const ROLE = 'ai';
const SHELL = process.platform === 'win32' ? 'powershell.exe' : 'bash';

let ws;

function send(type, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, ...payload }));
  }
}

function runLocalCommand(command) {
  return new Promise((resolve) => {
    exec(command, { shell: SHELL, cwd: process.cwd() }, (err, stdout, stderr) => {
      if (err) resolve(stderr || err.message);
      else resolve(stdout);
    });
  });
}

async function handleMention(text, from) {
  const lower = text.toLowerCase();
  let response = null;

  if (lower.includes('fichier') || lower.includes('modifié') || lower.includes('git status')) {
    const out = await runLocalCommand('git status --short');
    response = out.trim() ? `Fichiers modifiés chez moi :\n${out}` : 'Aucun fichier modifié de mon côté.';
  } else if (lower.includes('branche') || lower.includes('branch')) {
    const out = await runLocalCommand('git branch --show-current');
    response = `Je suis sur la branche : ${out.trim()}`;
  } else if (lower.includes('log') || lower.includes('commit')) {
    const out = await runLocalCommand('git log --oneline -5');
    response = `Derniers commits :\n${out.trim()}`;
  } else if (lower.includes('aide') || lower.includes('help')) {
    response = 'Tu peux me demander : fichiers modifiés, branche actuelle, derniers commits, ou /peek <nom>.';
  }

  if (response) {
    send('chat', { text: `@${from} ${response}` });
  }
}

function connect() {
  ws = new WebSocket(SERVER);

  ws.on('open', () => {
    send('register', { name: NAME, role: ROLE, room: ROOM });
    send('chat', { text: `👋 ${NAME} est connecté(e) et observe dans #${ROOM}.` });
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    console.log(chalk.gray(`[${msg.type}] ${msg.from || ''}: ${msg.text || msg.data || ''}`));

    if (msg.type === 'chat' && msg.from !== NAME) {
      const mention = `@${NAME}`;
      if (msg.text.includes(mention)) {
        handleMention(msg.text, msg.from);
      }
    }
  });

  ws.on('close', () => {
    console.log(chalk.red('Déconnecté. Reconnexion dans 3s...'));
    setTimeout(connect, 3000);
  });

  ws.on('error', (err) => {
    console.error(chalk.red(`Erreur : ${err.message}`));
  });
}

console.log(chalk.cyan(`Agent IA ${NAME} dans #${ROOM}. En attente de connexion...`));
connect();
