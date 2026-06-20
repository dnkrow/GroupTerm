// Commande-outil one-shot pour group-terminal : peek / say / chat.
// Appelée par les shims injectés dans le PATH (peek.cmd, say.cmd, chat.cmd, et
// leurs équivalents bash). Lit le contexte via les variables d'environnement
// GT_SERVER / GT_ROOM / GT_NAME héritées du shell lancé par le wrapper.
const WebSocket = require('ws');

const SERVER = process.env.GT_SERVER || 'ws://localhost:4242';
const ROOM = process.env.GT_ROOM || 'default';
const FROM = process.env.GT_NAME || 'anon';

const argv = process.argv.slice(2);
const cmd = argv[0];
const rest = argv.slice(1);

if (!['peek', 'say', 'chat'].includes(cmd)) {
  console.error('Usage : gt-tool <peek|say|chat> [args]');
  process.exit(2);
}

// Construit la requête selon la commande
const req = { type: 'tool', cmd, room: ROOM, from: FROM };

if (cmd === 'peek') {
  // peek [nom] [-n N]
  const args = [...rest];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-n' || args[i] === '--lines') {
      req.n = parseInt(args[i + 1], 10);
      i++;
    } else if (!args[i].startsWith('-') && !req.target) {
      req.target = args[i];
    }
  }
} else if (cmd === 'say') {
  // say [--to nom] <message...>
  const args = [...rest];
  const words = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--to' || args[i] === '-t') {
      req.target = args[i + 1];
      i++;
    } else {
      words.push(args[i]);
    }
  }
  req.text = words.join(' ');
} else if (cmd === 'chat') {
  // chat [-n N]
  const args = [...rest];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-n' || args[i] === '--lines') {
      req.n = parseInt(args[i + 1], 10);
      i++;
    }
  }
}

const ws = new WebSocket(SERVER);
let done = false;

const timer = setTimeout(() => {
  if (!done) {
    console.error(`[${cmd}] pas de réponse du serveur (${SERVER}).`);
    process.exit(1);
  }
}, 5000);

ws.on('open', () => ws.send(JSON.stringify(req)));

ws.on('message', (raw) => {
  let msg;
  try { msg = JSON.parse(raw.toString()); } catch { return; }
  if (msg.type !== 'tool-result') return;
  done = true;
  clearTimeout(timer);
  if (msg.text) console.log(msg.text);
  ws.close();
  process.exit(msg.ok ? 0 : 1);
});

ws.on('error', (err) => {
  if (done) return;
  console.error(`[${cmd}] connexion impossible : ${err.message}`);
  process.exit(1);
});
