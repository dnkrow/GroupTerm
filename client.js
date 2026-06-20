const WebSocket = require('ws');
const { exec } = require('child_process');
const readline = require('readline');
const chalk = require('chalk');

const SERVER = process.env.SERVER || 'ws://localhost:4242';
const NAME = process.env.NAME || process.argv[2] || 'anonyme';
const ROOM = process.env.ROOM || process.argv[3] || 'default';
const ROLE = process.env.ROLE || 'human';
const SHELL = process.platform === 'win32' ? 'powershell.exe' : 'bash';

let ws;
let rl;

function formatMessage(msg) {
  switch (msg.type) {
    case 'chat': {
      const color = msg.role === 'ai' ? chalk.cyan : chalk.green;
      return `${color(`[${msg.from}]`)} ${msg.text}`;
    }
    case 'system':
      return chalk.yellow(`[système] ${msg.text}`);
    case 'terminal':
      return chalk.gray(`[${msg.from}] ${msg.data}`);
    case 'peek-result': {
      if (!msg.found) return chalk.red(`[peek] ${msg.target} introuvable.`);
      return chalk.magenta(`--- terminal de ${msg.target} ---\n${msg.buffer}\n--- fin ---`);
    }
    default:
      return JSON.stringify(msg);
  }
}

function logAbovePrompt(text) {
  readline.cursorTo(process.stdout, 0);
  readline.clearLine(process.stdout, 0);
  console.log(text);
  if (rl) rl.prompt(true);
}

function send(type, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, ...payload }));
  }
}

function connect() {
  ws = new WebSocket(SERVER);

  ws.on('open', () => {
    send('register', { name: NAME, role: ROLE, room: ROOM });
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    logAbovePrompt(formatMessage(msg));
  });

  ws.on('close', () => {
    logAbovePrompt(chalk.red('[système] Déconnecté. Reconnexion dans 3s...'));
    setTimeout(connect, 3000);
  });

  ws.on('error', (err) => {
    logAbovePrompt(chalk.red(`[erreur] ${err.message}`));
  });
}

function runCommand(line) {
  // Exécute la commande via un shell, capture stdout/stderr
  const child = exec(line, { shell: SHELL, cwd: process.cwd() }, (err, stdout, stderr) => {
    const output = [
      err ? chalk.red(stderr || err.message) : '',
      stdout || '',
    ].join('\n');

    if (output.trim()) {
      console.log(output);
      send('terminal', { data: output });
    }
    rl.prompt();
  });
}

function startInput() {
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.blue(`${NAME}> `),
  });

  rl.prompt();

  rl.on('line', (line) => {
    const trimmed = line.trim();

    if (trimmed.startsWith('/msg ')) {
      send('chat', { text: trimmed.slice(5) });
      rl.prompt();
    } else if (trimmed.startsWith('/peek ')) {
      send('peek', { target: trimmed.slice(6) });
      rl.prompt();
    } else if (trimmed === '/who') {
      send('who', {});
      rl.prompt();
    } else if (trimmed === '/help') {
      console.log(chalk.blue(
        'Commandes : /msg <texte>  /peek <nom>  /who  /help  /quit'
      ));
      rl.prompt();
    } else if (trimmed === '/quit') {
      process.exit(0);
    } else if (trimmed) {
      runCommand(line);
    } else {
      rl.prompt();
    }
  });

  rl.on('close', () => {
    console.log(chalk.yellow('Au revoir.'));
    process.exit(0);
  });
}

console.log(chalk.blue(`Group Terminal - ${NAME} (${ROLE}) dans #${ROOM}`));
console.log(chalk.blue(`Serveur : ${SERVER}`));
console.log(chalk.gray('Tape /help pour la liste des commandes.\n'));

connect();
startInput();
