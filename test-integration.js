const WebSocket = require('ws');
const chalk = require('chalk');

const SERVER = 'ws://localhost:4242';
const ROOM = 'test-room';

function createClient(name, role, room = ROOM) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(SERVER);
    const messages = [];
    let registered = false;

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'register', name, role, room }));
    });

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      messages.push(msg);
      if (msg.type === 'system' && msg.text.includes('Bienvenue')) {
        registered = true;
        resolve({ ws, messages, waitFor, registered: () => registered });
      }
    });

    ws.on('error', reject);

    function waitFor(predicate, timeoutMs = 2000) {
      const fn = typeof predicate === 'string' ? (m) => m.type === predicate : predicate;
      return new Promise((resolveWait, rejectWait) => {
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
          rejectWait(new Error(`Timeout en attendant message`));
        }, timeoutMs);
      });
    }
  });
}

async function run() {
  console.log(chalk.blue('Test d\'intégration group-terminal'));

  const alice = await createClient('alice', 'human');
  await new Promise(r => setTimeout(r, 100));
  const bob = await createClient('bob', 'human');
  await new Promise(r => setTimeout(r, 100));

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

  // Test isolation de room : charlie dans une autre room ne doit pas recevoir le chat
  const charlie = await createClient('charlie', 'human', 'autre-room');
  await new Promise(r => setTimeout(r, 100));
  alice.ws.send(JSON.stringify({ type: 'chat', text: 'Message secret' }));

  let charlieReceived = false;
  try {
    await charlie.waitFor(m => m.type === 'chat' && m.text === 'Message secret', 500);
    charlieReceived = true;
  } catch {
    charlieReceived = false;
  }
  console.assert(charlieReceived === false, 'charlie ne doit pas recevoir les messages d\'une autre room');
  console.log(chalk.green('✓ Rooms isolées'));

  // Test historique : dave rejoint la room et doit recevoir l'historique
  const dave = await createClient('dave', 'human');
  const historyMsg = await dave.waitFor('history');
  console.assert(historyMsg.kind === 'chat', 'L\'historique doit être du chat');
  console.assert(historyMsg.items.some(i => i.text === 'Salut Bob !'), 'L\'historique doit contenir le message');
  console.log(chalk.green('✓ Historique envoyé aux nouveaux arrivants'));

  console.log(chalk.green('\nTous les tests sont passés !'));

  alice.ws.close();
  bob.ws.close();
  charlie.ws.close();
  dave.ws.close();
  process.exit(0);
}

run().catch(err => {
  console.error(chalk.red('Test échoué :'), err);
  process.exit(1);
});
