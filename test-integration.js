const WebSocket = require('ws');
const chalk = require('chalk');

const SERVER = 'ws://localhost:4242';

function createClient(name, role) {
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
      console.log(chalk.gray(`[${name}] reçu :`), msg.type, msg.from || '', msg.text || msg.data || '');
    });

    function waitFor(predicate, timeoutMs = 2000) {
      return new Promise((resolveWait, reject) => {
        const fn = typeof predicate === 'string'
          ? (m) => m.type === predicate
          : predicate;

        const check = () => messages.find(fn);
        const found = check();
        if (found) return resolveWait(found);

        const interval = setInterval(() => {
          const foundNow = check();
          if (foundNow) {
            clearInterval(interval);
            clearTimeout(timer);
            resolveWait(foundNow);
          }
        }, 100);

        const timer = setTimeout(() => {
          clearInterval(interval);
          reject(new Error(`Timeout en attendant message`));
        }, timeoutMs);
      });
    }
  });
}

async function run() {
  console.log(chalk.blue('Test d\'intégration group-terminal'));

  const alice = await createClient('alice', 'human');
  await new Promise(r => setTimeout(r, 300));
  const bob = await createClient('bob', 'human');
  await new Promise(r => setTimeout(r, 300));

  // Test chat
  alice.ws.send(JSON.stringify({ type: 'chat', text: 'Salut Bob !' }));
  const chatMsg = await bob.waitFor('chat');
  console.assert(chatMsg.from === 'alice', 'Le chat doit venir d\'alice');
  console.assert(chatMsg.text === 'Salut Bob !', 'Le texte doit être exact');
  console.log(chalk.green('✓ Chat relayé'));

  // Test terminal
  alice.ws.send(JSON.stringify({ type: 'terminal', data: 'git status\nOn branch main' }));
  const termMsg = await bob.waitFor('terminal');
  console.assert(termMsg.from === 'alice', 'Le terminal doit venir d\'alice');
  console.log(chalk.green('✓ Terminal relayé'));

  // Test peek
  bob.ws.send(JSON.stringify({ type: 'peek', target: 'alice' }));
  const peekMsg = await bob.waitFor('peek-result');
  console.assert(peekMsg.found === true, 'alice doit être trouvable');
  console.assert(peekMsg.buffer.includes('git status'), 'Le buffer doit contenir git status');
  console.log(chalk.green('✓ Peek fonctionne'));

  // Test who
  bob.ws.send(JSON.stringify({ type: 'who' }));
  const whoMsg = await bob.waitFor(m => m.type === 'system' && m.text.includes('Connectés'));
  console.assert(whoMsg.text.includes('alice') && whoMsg.text.includes('bob'), '/who doit lister alice et bob');
  console.log(chalk.green('✓ /who fonctionne'));

  console.log(chalk.green('\nTous les tests sont passés !'));

  alice.ws.close();
  bob.ws.close();
  process.exit(0);
}

run().catch(err => {
  console.error(chalk.red('Test échoué :'), err);
  process.exit(1);
});
