const WebSocket = require('ws');

const PORT = process.env.PORT || 4242;
const MAX_BUFFER_LINES = 500;

const wss = new WebSocket.Server({ port: PORT });
const clients = new Map(); // ws => { name, role, buffer: string[] }

function broadcast(sender, message) {
  const payload = JSON.stringify(message);
  for (const [client] of clients) {
    if (client !== sender && client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

function systemBroadcast(text) {
  const payload = JSON.stringify({ type: 'system', text });
  for (const [client] of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

function findClientByName(name) {
  for (const [, meta] of clients) {
    if (meta.name === name) return meta;
  }
  return null;
}

wss.on('connection', (ws) => {
  console.log(`[+] Nouvelle connexion (${wss.clients.size} connecté(s))`);

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    const meta = clients.get(ws);

    if (msg.type === 'register') {
      const name = String(msg.name || 'anonyme').slice(0, 32);
      const role = msg.role === 'ai' ? 'ai' : 'human';
      if (findClientByName(name)) {
        ws.send(JSON.stringify({ type: 'system', text: `Le nom "${name}" est déjà pris.` }));
        ws.close();
        return;
      }
      clients.set(ws, { name, role, buffer: [] });
      ws.send(JSON.stringify({ type: 'system', text: `Bienvenue, ${name} (${role}). Commandes: /msg <texte>, /peek <nom>, /who` }));
      systemBroadcast(`${name} (${role}) a rejoint le terminal de groupe.`);
      return;
    }

    if (!meta) return;

    if (msg.type === 'chat') {
      const text = String(msg.text || '').slice(0, 2000);
      broadcast(ws, { type: 'chat', from: meta.name, role: meta.role, text });
    }

    if (msg.type === 'terminal') {
      const data = String(msg.data || '');
      // Stocke le buffer ligne par ligne pour les /peek
      const lines = data.split('\n');
      for (const line of lines) {
        meta.buffer.push(line);
        if (meta.buffer.length > MAX_BUFFER_LINES) meta.buffer.shift();
      }
      broadcast(ws, { type: 'terminal', from: meta.name, role: meta.role, data });
    }

    if (msg.type === 'peek') {
      const target = findClientByName(msg.target);
      if (!target) {
        ws.send(JSON.stringify({ type: 'peek-result', target: msg.target, found: false, buffer: '' }));
      } else {
        const buffer = target.buffer.slice(-50).join('\n');
        ws.send(JSON.stringify({ type: 'peek-result', target: msg.target, found: true, buffer }));
      }
    }

    if (msg.type === 'who') {
      const list = Array.from(clients.values()).map(c => `${c.name} (${c.role})`).join(', ');
      ws.send(JSON.stringify({ type: 'system', text: `Connectés : ${list}` }));
    }
  });

  ws.on('close', () => {
    const meta = clients.get(ws);
    clients.delete(ws);
    if (meta) {
      systemBroadcast(`${meta.name} (${meta.role}) a quitté le terminal.`);
    }
    console.log(`[-] Déconnexion (${wss.clients.size} connecté(s))`);
  });

  ws.on('error', (err) => {
    console.error('Erreur WebSocket :', err.message);
  });
});

console.log(`Serveur group-terminal démarré sur ws://localhost:${PORT}`);
