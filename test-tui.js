const pty = require('node-pty');
const chalk = require('chalk');

const SHELL = process.platform === 'win32' ? 'powershell.exe' : 'bash';

console.log(chalk.blue('Test du client TUI dans un pseudo-terminal'));

const term = pty.spawn(SHELL, [], {
  name: 'xterm-color',
  cols: 120,
  rows: 40,
  cwd: process.cwd(),
  env: process.env,
});

let output = '';
let killed = false;

term.onData((data) => {
  output += data;
  if (output.length > 5000) output = output.slice(-5000);
});

term.onExit(({ exitCode }) => {
  killed = true;
  console.log(chalk.gray(`Client TUI terminé avec le code ${exitCode}`));
});

// Lance le client TUI
term.write('node client-tui.js tui-user tui-room\r');

// Attend 3 secondes puis vérifie qu'il tourne encore
setTimeout(() => {
  if (killed) {
    console.error(chalk.red('✗ Le client TUI s\'est arrêté prématurément.'));
    console.error(chalk.gray(output.slice(-1000)));
    process.exit(1);
  }

  if (output.includes('Bienvenue') || output.includes('Group Terminal')) {
    console.log(chalk.green('✓ Le client TUI a démarré et s\'est connecté au serveur'));
  } else {
    console.error(chalk.red('✗ Le client TUI ne semble pas s\'être connecté.'));
    console.error(chalk.gray(output.slice(-1000)));
    process.exit(1);
  }

  // Vérifie qu'il n'y a pas d'erreur fatale
  if (output.includes('FATAL ERROR') || output.includes('heap out of memory')) {
    console.error(chalk.red('✗ Le client TUI a crashé (fuite mémoire).'));
    process.exit(1);
  }

  console.log(chalk.green('✓ Pas de crash détecté après 3 secondes'));
  term.kill();
  process.exit(0);
}, 3000);
