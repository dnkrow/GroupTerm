const blessed = require('blessed');
const WebSocket = require('ws');
const pty = require('node-pty');
const chalk = require('chalk');

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error(chalk.red('Ce client doit être lancé dans un vrai terminal (pas un pipe).'));
  console.error(chalk.gray('Utilise : npm run client:tui -- <nom> <room>'));
  process.exit(1);
}

const SERVER = process.env.SERVER || 'ws://localhost:4242';
const NAME = process.env.NAME || process.argv[2] || 'anonyme';
const ROOM = process.env.ROOM || process.argv[3] || 'default';
const ROLE = process.env.ROLE || 'human';
const SHELL = process.platform === 'win32' ? 'powershell.exe' : process.platform === 'darwin' ? 'zsh' : 'bash';

let ws;
let shell;
let screen;
let terminalBox;
let chatLog;
let chatInput;
let chatMode = false;
let localOutputBuffer = '';
let sendBufferTimer = null;

function send(type, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, ...payload }));
  }
}

function addChatLine(line) {
  chatLog.log(line);
  screen.render();
}

function addRemoteTerminal(data, from) {
  const prefix = chalk.gray(`[${from}] `);
  const lines = data.split('\n');
  for (const line of lines) {
    if (line.trim()) {
      chatLog.log(prefix + line);
    }
  }
  screen.render();
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

    switch (msg.type) {
      case 'chat': {
        const color = msg.role === 'ai' ? chalk.cyan : chalk.green;
        addChatLine(color(`[${msg.from}]`) + ' ' + msg.text);
        break;
      }
      case 'system':
        addChatLine(chalk.yellow(`[système] ${msg.text}`));
        break;
      case 'terminal':
        addRemoteTerminal(msg.data, msg.from);
        break;
      case 'peek-result': {
        if (!msg.found) {
          addChatLine(chalk.red(`[peek] ${msg.target} introuvable.`));
        } else {
          addChatLine(chalk.magenta(`--- terminal de ${msg.target} ---`));
          for (const line of msg.buffer.split('\n')) {
            addChatLine(chalk.magenta(line));
          }
          addChatLine(chalk.magenta('--- fin ---'));
        }
        break;
      }
      case 'history': {
        if (msg.kind === 'chat') {
          for (const item of msg.items) {
            const color = item.role === 'ai' ? chalk.cyan : chalk.green;
            addChatLine(chalk.gray('(historique) ') + color(`[${item.from}]`) + ' ' + item.text);
          }
        } else if (msg.kind === 'terminal') {
          for (const item of msg.items) {
            addRemoteTerminal(item.data, item.from);
          }
        }
        break;
      }
      default:
        break;
    }
  });

  ws.on('close', () => {
    addChatLine(chalk.red('[système] Déconnecté. Reconnexion dans 3s...'));
    setTimeout(connect, 3000);
  });

  ws.on('error', (err) => {
    addChatLine(chalk.red(`[erreur] ${err.message}`));
  });
}

function flushTerminalBuffer() {
  if (localOutputBuffer) {
    send('terminal', { data: localOutputBuffer });
    localOutputBuffer = '';
  }
}

function startShell() {
  shell = pty.spawn(SHELL, [], {
    name: 'xterm-color',
    cols: terminalBox.width - 2,
    rows: terminalBox.height - 2,
    cwd: process.cwd(),
    env: process.env,
  });

  shell.onData((data) => {
    terminalBox.setContent(terminalBox.getContent() + data);
    terminalBox.scroll(terminalBox.getScrollHeight());
    screen.render();

    localOutputBuffer += data;
    if (sendBufferTimer) clearTimeout(sendBufferTimer);
    if (localOutputBuffer.length > 400 || data.includes('\n') || data.includes('\r')) {
      flushTerminalBuffer();
    } else {
      sendBufferTimer = setTimeout(flushTerminalBuffer, 200);
    }
  });

  // Redimensionnement
  screen.on('resize', () => {
    shell.resize(terminalBox.width - 2, terminalBox.height - 2);
  });
}

function buildUI() {
  screen = blessed.screen({
    smartCSR: true,
    title: `Group Terminal - ${NAME} @ #${ROOM}`,
  });

  terminalBox = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    height: '80%-1',
    label: ` {bold}${NAME} (local){/bold} — Tab pour chatter — Ctrl+C pour quitter `,
    border: 'line',
    scrollable: true,
    alwaysScroll: true,
    tags: true,
    style: {
      fg: 'default',
      bg: 'default',
      border: { fg: 'blue' },
      focus: { border: { fg: 'green' } },
    },
  });

  chatLog = blessed.log({
    parent: screen,
    top: '80%-1',
    left: 0,
    width: '100%',
    height: '20%',
    label: ' {bold}Chat & Activité{/bold} ',
    border: 'line',
    scrollable: true,
    alwaysScroll: true,
    tags: true,
    style: {
      border: { fg: 'yellow' },
      focus: { border: { fg: 'green' } },
    },
  });

  chatInput = blessed.textbox({
    parent: screen,
    bottom: 0,
    left: 0,
    width: '100%',
    height: 3,
    label: ' {bold}Message{/bold} (Entrée pour envoyer, Esc/Esc pour annuler) ',
    border: 'line',
    inputOnFocus: true,
    style: {
      border: { fg: 'green' },
      focus: { border: { fg: 'cyan' } },
    },
    hidden: true,
  });

  // Capture les touches pour le shell local quand on n'est pas en mode chat
  screen.on('keypress', (ch, key) => {
    if (chatMode) return;
    if (key.name === 'tab') return;
    if (key.ctrl && key.name === 'c') return;

    let seq = ch || '';
    if (key.sequence) seq = key.sequence;
    if (shell) shell.write(seq);
  });

  chatInput.on('submit', () => {
    const text = chatInput.getValue().trim();
    chatInput.clearValue();
    hideChatInput();

    if (!text) return;

    if (text.startsWith('/msg ')) {
      send('chat', { text: text.slice(5) });
    } else if (text.startsWith('/peek ')) {
      send('peek', { target: text.slice(6) });
    } else if (text === '/who') {
      send('who', {});
    } else if (text === '/help') {
      addChatLine(chalk.blue('Commandes : /msg <texte>  /peek <nom>  /who  /help  /quit'));
    } else if (text === '/quit') {
      process.exit(0);
    } else if (text.startsWith('/')) {
      addChatLine(chalk.red(`Commande inconnue : ${text}`));
    } else {
      send('chat', { text });
    }
  });

  chatInput.on('cancel', hideChatInput);

  function showChatInput() {
    chatMode = true;
    chatInput.show();
    chatInput.focus();
    screen.render();
  }

  function hideChatInput() {
    chatMode = false;
    chatInput.hide();
    terminalBox.focus();
    screen.render();
  }

  screen.key(['tab'], () => {
    if (chatMode) hideChatInput();
    else showChatInput();
  });

  screen.key(['C-c'], () => {
    process.exit(0);
  });

  terminalBox.focus();
  screen.render();
}

function start() {
  connect();
  buildUI();
  startShell();
}

start();
