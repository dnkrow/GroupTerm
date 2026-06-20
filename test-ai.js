const WebSocket = require('ws');
const { exec } = require('child_process');
const chalk = require('chalk');

const SERVER = 'ws://localhost:4242';
const SHELL = process.platform === 'win32' ? 'powershell.exe' : 'bash';

function createClient(name, role, onMessage) {
  return new Promise((resolve) => {
    const ws = new WebSocket(SERVER);
    const messages = [];

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'register', name, role }));
      resolve({ ws, messages, waitFor });
    });

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      messages.push(msg);
      if (onMessage) onMessage(ws, msg);
    });

    function waitFor(predicate, timeoutMs = 3000) {
      const fn = typeof predicate === 'string' ? (m) => m.type === predicate : predicate;
      return new Promise((resolveWait, reject) => {
        const found = messages.find(fn);
        if (found) return resolveWait(found);

        const interval = setInterval(() => {
          const f = messages.find(fn);
          if (f) {
            clearInterval(interval);
            clearTimeout(timer);
            resolveWait(f);
          }
        }, 100);

        const timer = setTimeout(() => {
          clearInterval(interval);
          reject(new Error('Timeout'));
        }, timeoutMs);
      });
    }
  });
}

async function run() {
  console.log(chalk.blue('Test agent IA'));

  // Client humain
  const alice = await createClient('alice', 'human');

  // Client IA simulé (même comportement que ai-agent.js)
  const botName = 'helper-bot';
  const bot = await createClient(botName, 'ai', (ws, msg) => {
    if (msg.type === 'chat' && msg.from !== botName) {
      const mention = `@${botName}`;
      if (msg.text.includes(mention) && msg.text.toLowerCase().includes('branche')) {
        exec('git branch --show-current', { shell: SHELL, cwd: process.cwd() }, (err, stdout) => {
          const branch = err ? 'inconnue' : stdout.trim();
          ws.send(JSON.stringify({ type: 'chat', text: `@${msg.from} Je suis sur la branche : ${branch}` }));
        });
      }
    }
  });

  await new Promise(r => setTimeout(r, 300));

  // alice mentionne l'IA
  alice.ws.send(JSON.stringify({ type: 'chat', text: `@${botName} sur quelle branche tu es ?` }));

  const reply = await alice.waitFor(m => m.type === 'chat' && m.from === botName);
  console.log(chalk.gray('Réponse IA :'), reply.text);
  console.assert(reply.text.includes('branche'), 'L\'IA doit répondre avec sa branche');

  console.log(chalk.green('✓ L\'agent IA répond aux mentions'));

  alice.ws.close();
  bot.ws.close();
  process.exit(0);
}

run().catch(err => {
  console.error(chalk.red('Test échoué :'), err);
  process.exit(1);
});
