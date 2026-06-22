// Hub GroupTerm — logique de la page. Parle UNIQUEMENT au hub local (WebSocket).
// Le hub relaie l'état du serveur et exécute les actions locales (ouvrir/fermer terminaux).

const LIVE_WINDOW_MS = 8000;
const state = {
  me: '…',
  rooms: new Map(),   // room => { roster:[{name,role,lastActivity}], chat:[{from,role,text,time}] }
  selected: null,
  peekTarget: null,
};

// --- WebSocket vers le hub local ---
let ws;
function connect() {
  ws = new WebSocket(`ws://${location.host}`);
  ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } handle(m); };
  ws.onclose = () => { setRelay(false); setTimeout(connect, 1500); };
}
function send(obj) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); }

// --- Réception ---
function handle(m) {
  if (m.type === 'hello') {
    state.me = m.name;
    el('me').textContent = m.name;
    setRelay(m.connected);
  } else if (m.type === 'relay') {
    setRelay(m.connected);
  } else if (m.type === 'rooms-snapshot') {
    state.rooms = new Map();
    for (const r of m.rooms) state.rooms.set(r.room, { roster: r.roster || [], chat: r.chat || [] });
    ensureSelection();
    renderAll();
  } else if (m.type === 'roster') {
    const s = getRoom(m.room); s.roster = m.members || [];
    ensureSelection();
    renderRooms(); renderMyTerms();
    if (m.room === state.selected) renderRoster();
  } else if (m.type === 'chat-event') {
    const s = getRoom(m.room);
    s.chat.push({ from: m.from, role: m.role, text: m.text, time: m.time });
    if (s.chat.length > 200) s.chat.shift();
    if (m.room === state.selected) renderChat();
  } else if (m.type === 'peek') {
    if (m.room === state.selected && m.target === state.peekTarget) {
      el('peek').textContent = m.text || '(écran vide)';
    }
  }
}

function getRoom(room) {
  if (!state.rooms.has(room)) state.rooms.set(room, { roster: [], chat: [] });
  return state.rooms.get(room);
}
function ensureSelection() {
  if (state.selected && state.rooms.has(state.selected)) return;
  const keys = [...state.rooms.keys()];
  const withMembers = keys.find((k) => state.rooms.get(k).roster.length);
  state.selected = withMembers || keys[0] || null;
}

// --- Utilitaires ---
const el = (id) => document.getElementById(id);
const live = (m) => Date.now() - (m.lastActivity || 0) < LIVE_WINDOW_MS;
const hhmm = (t) => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
function esc(s) { return (s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function setRelay(ok) {
  const r = el('relay');
  r.textContent = ok ? 'relais connecté' : 'relais déconnecté';
  r.className = 'relay ' + (ok ? 'on' : 'off');
}

// --- Rendu ---
function renderAll() { renderRooms(); renderChat(); renderRoster(); renderMyTerms(); }

function renderRooms() {
  const ul = el('room-list');
  ul.innerHTML = '';
  const keys = [...state.rooms.keys()].sort();
  if (!keys.length) { ul.innerHTML = '<li class="empty">aucune room ouverte</li>'; return; }
  for (const room of keys) {
    const { roster } = state.rooms.get(room);
    const li = document.createElement('li');
    if (room === state.selected) li.className = 'sel';
    const dots = roster.map((m) => `<span class="dot ${live(m) ? 'active' : ''}" title="${live(m) ? 'connecté · actif' : 'connecté'}">●</span>`).join('');
    li.innerHTML = `<div class="room-name">#${esc(room)}</div>
      <div class="room-meta">${dots || '<span class="muted">vide</span>'}<span class="count">${roster.length}</span></div>`;
    li.onclick = () => selectRoom(room);
    ul.appendChild(li);
  }
}

function renderChat() {
  el('chat-room').textContent = state.selected || '—';
  const box = el('messages');
  const room = state.selected && state.rooms.get(state.selected);
  if (!room || !room.chat.length) { box.innerHTML = '<div class="empty">(aucun message)</div>'; return; }
  box.innerHTML = room.chat.map((e) =>
    `<div class="msg"><span class="time">${hhmm(e.time)}</span><span class="from ${e.role === 'ai' ? 'ai' : 'human'}">${esc(e.from)}:</span>${esc(e.text)}</div>`
  ).join('');
  box.scrollTop = box.scrollHeight;
}

function renderRoster() {
  const ul = el('roster');
  ul.innerHTML = '';
  const room = state.selected && state.rooms.get(state.selected);
  if (!room || !room.roster.length) { ul.innerHTML = '<li class="empty">personne</li>'; return; }
  for (const m of room.roster) {
    const li = document.createElement('li');
    const mine = m.name === state.me;
    if (mine) li.className = 'me';
    li.innerHTML = `<span class="dot ${live(m) ? 'active' : ''}" title="${live(m) ? 'connecté · actif' : 'connecté'}">●</span>
      <span class="name ${m.role === 'ai' ? 'ai' : ''}">${esc(m.name)}</span>
      <span class="role">${esc(m.role)}</span>`;
    if (!mine) li.onclick = () => setPeek(m.name);
    ul.appendChild(li);
  }
}

function renderMyTerms() {
  const box = el('myterms-list');
  const mine = [...state.rooms.entries()].filter(([, v]) => v.roster.some((m) => m.name === state.me)).map(([room]) => room);
  if (!mine.length) { box.innerHTML = '<span class="muted">aucun</span>'; return; }
  box.innerHTML = '';
  for (const room of mine) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `#${esc(room)} <button title="Fermer ce terminal">✕</button>`;
    chip.querySelector('button').onclick = () => { if (confirm(`Fermer ton terminal dans #${room} ?`)) send({ cmd: 'close-terminal', room }); };
    box.appendChild(chip);
  }
}

// --- Actions ---
function selectRoom(room) {
  if (state.selected === room) return;
  state.selected = room;
  stopPeek();
  renderAll();
}

function setPeek(target) {
  state.peekTarget = target;
  el('peek-target').textContent = target;
  el('peek').textContent = '…';
  el('peek-wrap').classList.remove('hidden');
  send({ cmd: 'peek', room: state.selected, target });
}
function stopPeek() {
  if (state.peekTarget) send({ cmd: 'peek-stop' });
  state.peekTarget = null;
  el('peek-wrap').classList.add('hidden');
}

// --- Branchements UI ---
el('say-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const inp = el('say-input');
  const raw = inp.value.trim();
  if (!raw || !state.selected) return;
  let text = raw, target;
  const mm = raw.match(/^@(\S+)\s+([\s\S]+)$/);
  if (mm) { target = mm[1]; text = mm[2]; }
  send({ cmd: 'say', room: state.selected, text, target });
  inp.value = '';
});

el('btn-open').onclick = () => {
  if (!state.selected) return alert('Sélectionne une room.');
  send({ cmd: 'open-terminal', room: state.selected });
};
el('btn-newroom').onclick = () => {
  const room = (prompt('Nom de la nouvelle room :') || '').trim();
  if (room) { send({ cmd: 'open-terminal', room }); state.selected = room; getRoom(room); renderAll(); }
};
el('peek-stop').onclick = stopPeek;

connect();
