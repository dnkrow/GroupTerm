const pty = require('node-pty');
const chalk = require('chalk');

const SHELL = process.platform === 'win32' ? 'powershell.exe' : 'bash';
const ROOM = 'demo-room';

function createSession(name, delay = 0) {
  return new Promise((resolve) => {
    setTimeout(() => {
      const term = pty.spawn(SHELL, [], {
        name: 'xterm-color',
        cols: 100,
        rows: 25,
        cwd: process.cwd(),
        env: process.env,
      });

      const output = [];
      term.onData((data) => {
        output.push(data);
      });

      term.write(`node client.js ${name} ${ROOM}\r`);

      resolve({ term, output, name });
    }, delay);
  });
}

function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function renderOutput(name, rawOutput) {
  const text = rawOutput.join('');
  // Nettoie un peu les séquences ANSI pour la lisibilité
  const cleaned = text
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter(line => line.trim())
    .slice(-20)
    .join('\n');

  console.log(chalk.blue(`\n=== Terminal de ${name} ===`));
  console.log(cleaned);
}

async function run() {
  console.log(chalk.green('Démarrage de la démo group-terminal...\n'));

  const alice = await createSession('alice');
  await wait(800);
  const bob = await createSession('bob');
  await wait(800);

  // Alice dit bonjour
  alice.term.write('/msg Salut Bob !\r');
  await wait(500);

  // Bob répond
  bob.term.write('/msg Salut Alice, je suis sur ma branche feature-x\r');
  await wait(500);

  // Alice demande à voir le terminal de Bob
  alice.term.write('/peek bob\r');
  await wait(500);

  // Bob exécute une commande (la sortie sera relayée à Alice)
  bob.term.write('git status --short\r');
  await wait(800);

  // Alice demande qui est connecté
  alice.term.write('/who\r');
  await wait(500);

  // Attendre un peu que tout se diffuse
  await wait(1000);

  renderOutput('alice', alice.output);
  renderOutput('bob', bob.output);

  // Quitte proprement
  alice.term.write('/quit\r');
  bob.term.write('/quit\r');
  await wait(300);

  alice.term.kill();
  bob.term.kill();

  console.log(chalk.green('\nDémo terminée.'));
  process.exit(0);
}

run().catch(err => {
  console.error(chalk.red('Erreur démo :'), err);
  process.exit(1);
});
