const blessed = require('blessed');
const WebSocket = require('ws');
const pty = require('node-pty');
const chalk = require('chalk');

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error(chalk.red('Ce client doit être lancé dans un vrai terminal (pas un pipe).'));
  console.error(chalk.gray('Utilise : npm run client:tui -- <nom> <room> [nom-a-observer]'));
  process.exit(1);
}

const SERVER = process.env.SERVER || 'ws://localhost:4242';
const NAME = process.env.NAME || process.argv[2] || 'anonyme';
const ROOM = process.env.ROOM || process.argv[3] || 'default';
const WATCH = process.env.WATCH || process.argv[4] || null; // Nom de la personne à observer (sinon tout le monde)
const ROLE = process.env.ROLE || 'human';
const SHELL = process.platform === 'win32' ? 'powershell.exe' : process.platform === 'darwin' ? 'zsh' : 'bash';

let ws;
let shell;
let screen;
let localBox;
let remoteBox;
let chatInput;
let chatMode = false;
let localOutputBuffer = '';
let sendBufferTimer = null;

function send(type, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, ...payload }));
  }
}

function addRemoteLine(line) {
  remoteBox.log(line);
  screen.render();
}

function addRemoteTerminal(data, from) {
  const prefix = chalk.gray(`[${from}] `);
  const lines = data.split('\n');
  for (const line of lines) {
    if (line.trim()) {
      remoteBox.log(prefix + line);
    }
  }
  screen.render();
}

function addRemoteChat(msg) {
  const color = msg.role === 'ai' ? chalk.cyan : chalk.green;
  addRemoteLine(color(`[${msg.from}]`) + ' ' + msg.text);
}

function shouldDisplayRemote(msg) {
  if (!WATCH) return true;
  return msg.from === WATCH;
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
        if (msg.from === NAME) break; // Pas besoin de réafficher ses propres messages
        if (shouldDisplayRemote(msg)) addRemoteChat(msg);
        break;
      }
      case 'system': {
        addRemoteLine(chalk.yellow(`[système] ${msg.text}`));
        break;
      }
      case 'terminal': {
        if (msg.from === NAME) break;
        if (shouldDisplayRemote(msg)) addRemoteTerminal(msg.data, msg.from);
        break;
      }
      case 'peek-result': {
        if (!msg.found) {
          addRemoteLine(chalk.red(`[peek] ${msg.target} introuvable.`));
        } else {
          addRemoteLine(chalk.magenta(`--- terminal de ${msg.target} ---`));
          for (const line of msg.buffer.split('\n')) {
            addRemoteLine(chalk.magenta(line));
          }
          addRemoteLine(chalk.magenta('--- fin ---'));
        }
        break;
      }
      case 'history': {
        if (msg.kind === 'chat') {
          for (const item of msg.items) {
            if (item.from === NAME) continue;
            if (shouldDisplayRemote(item)) {
              const color = item.role === 'ai' ? chalk.cyan : chalk.green;
              addRemoteLine(chalk.gray('(historique) ') + color(`[${item.from}]`) + ' ' + item.text);
            }
          }
        } else if (msg.kind === 'terminal') {
          for (const item of msg.items) {
            if (item.from === NAME) continue;
            if (shouldDisplayRemote(item)) addRemoteTerminal(item.data, item.from);
          }
        }
        break;
      }
      default:
        break;
    }
  });

  ws.on('close', () => {
    addRemoteLine(chalk.red('[système] Déconnecté. Reconnexion dans 3s...'));
    setTimeout(connect, 3000);
  });

  ws.on('error', (err) => {
    addRemoteLine(chalk.red(`[erreur] ${err.message}`));
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
    cols: localBox.width - 2,
    rows: localBox.height - 2,
    cwd: process.cwd(),
    env: process.env,
  });

  shell.onData((data) => {
    localBox.setContent(localBox.getContent() + data);
    localBox.scroll(localBox.getScrollHeight());
    screen.render();

    localOutputBuffer += data;
    if (sendBufferTimer) clearTimeout(sendBufferTimer);
    if (localOutputBuffer.length > 400 || data.includes('\n') || data.includes('\r')) {
      flushTerminalBuffer();
    } else {
      sendBufferTimer = setTimeout(flushTerminalBuffer, 200);
    }
  });

  screen.on('resize', () => {
    shell.resize(localBox.width - 2, localBox.height - 2);
  });
}

function buildUI() {
  const watchLabel = WATCH ? ` (observant ${WATCH})` : '';

  screen = blessed.screen({
    smartCSR: true,
    title: `Group Terminal - ${NAME} @ #${ROOM}${watchLabel}`,
  });

  // Terminal local (gauche)
  localBox = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: '50%',
    height: '100%-3',
    label: ` {bold}${NAME} (toi){/bold} — Tab pour chatter — Ctrl+C pour quitter `,
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

  // Terminal distant (droite)
  remoteBox = blessed.log({
    parent: screen,
    top: 0,
    left: '50%',
    width: '50%',
    height: '100%-3',
    label: ` {bold}Terminal distant${watchLabel}{/bold} `,
    border: 'line',
    scrollable: true,
    alwaysScroll: true,
    tags: true,
    style: {
      border: { fg: 'yellow' },
      focus: { border: { fg: 'green' } },
    },
  });

  // Input de chat (bas)
  chatInput = blessed.textbox({
    parent: screen,
    bottom: 0,
    left: 0,
    width: '100%',
    height: 3,
    label: ' {bold}Message{/bold} (Entrée pour envoyer, Esc pour annuler) ',
    border: 'line',
    inputOnFocus: true,
    style: {
      border: { fg: 'green' },
      focus: { border: { fg: 'cyan' } },
    },
    hidden: false,
  });

  // Capture les touches pour le shell local quand on n'est pas en mode chat
  screen.on('keypress', (ch, key) => {
    if (chatMode) return;
    if (screen.focused === chatInput) return;
    if (key.name === 'tab') return;
    if (key.ctrl && key.name === 'c') return;

    let seq = ch || '';
    if (key.sequence) seq = key.sequence;
    if (shell) shell.write(seq);
  });

  chatInput.key(['tab', 'escape'], () => {
    hideChatInput();
  });

  chatInput.on('submit', () => {
    const text = chatInput.getValue().trim();
    chatInput.clearValue();
    hideChatInput();

    if (!text) return;

    if (text.startsWith('/msg ')) {
      send('chat', { text: text.slice(5) });
      addRemoteLine(chalk.green(`[moi] ${text.slice(5)}`));
    } else if (text.startsWith('/peek ')) {
      send('peek', { target: text.slice(6) });
    } else if (text === '/who') {
      send('who', {});
    } else if (text === '/help') {
      addRemoteLine(chalk.blue('Commandes : /msg <texte>  /peek <nom>  /who  /help  /quit'));
    } else if (text === '/quit') {
      process.exit(0);
    } else if (text.startsWith('/')) {
      addRemoteLine(chalk.red(`Commande inconnue : ${text}`));
    } else {
      send('chat', { text });
      addRemoteLine(chalk.green(`[moi] ${text}`));
    }
  });

  chatInput.on('cancel', hideChatInput);



  function hideChatInput() {
    chatMode = false;
    chatInput.clearValue();
    localBox.focus();
    localBox.setLabel(` {bold}${NAME} (toi){/bold} — Tab pour chatter — Ctrl+C pour quitter `);
    chatInput.setLabel(' {bold}Message{/bold} ');
    screen.render();
  }

  function showChatInput() {
    chatMode = true;
    chatInput.focus();
    localBox.setLabel(` {bold}${NAME} (toi){/bold} `);
    chatInput.setLabel(' {bold}Message{/bold} (Entrée pour envoyer, Tab/Esc pour retourner au terminal) ');
    screen.render();
  }

  screen.key(['tab'], () => {
    if (chatMode) hideChatInput();
    else showChatInput();
  });

  screen.key(['C-c'], () => {
    process.exit(0);
  });

  localBox.focus();
  screen.render();
}

function start() {
  connect();
  buildUI();
  startShell();
}

start();
