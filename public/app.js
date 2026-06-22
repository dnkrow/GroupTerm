// Hub GroupTerm — logique de la page. Parle UNIQUEMENT au hub local (WebSocket).
// Le hub relaie l'état du serveur et exécute les actions locales (ouvrir/fermer terminaux).

const LIVE_WINDOW_MS = 8000;
const state = {
  me: '…',
  rooms: new Map(),        // room => { roster:[{name,role,lastActivity}], chat:[{from,role,text,time}] }
  selected: null,
  tab: 'chat',             // 'chat' | 'peek'
  peekTarget: null,        // membre actuellement observé (dérivé de la room sélectionnée)
  peekByRoom: {},          // mémorise la cible peek choisie par room
  sayToByRoom: {},         // destinataire say choisi par room ('all' ou un nom)
};
let peekActive = null;     // { room, target } en cours de poll côté hub

// --- WebSocket vers le hub local ---
let ws;
function connect() {
  ws = new WebSocket(`ws://${location.host}`);
  ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } handle(m); };
  ws.onclose = () => { setRelay(false); peekActive = null; setTimeout(connect, 1500); };
}
function send(obj) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); }

// --- Réception ---
function handle(m) {
  if (m.type === 'hello') {
    state.me = m.name; el('me').textContent = m.name; setRelay(m.connected);
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
    if (m.room === state.selected) { renderRoster(); if (state.tab === 'peek') renderPeek(); else renderSayTo(); }
  } else if (m.type === 'chat-event') {
    const s = getRoom(m.room);
    s.chat.push({ from: m.from, role: m.role, text: m.text, time: m.time });
    if (s.chat.length > 200) s.chat.shift();
    if (m.room === state.selected && state.tab === 'chat') renderChat();
  } else if (m.type === 'peek') {
    if (state.tab === 'peek' && m.room === state.selected && m.target === state.peekTarget) {
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
  state.selected = keys.find((k) => state.rooms.get(k).roster.length) || keys[0] || null;
}

// --- Utilitaires ---
const el = (id) => document.getElementById(id);
const live = (m) => Date.now() - (m.lastActivity || 0) < LIVE_WINDOW_MS;
const hhmm = (t) => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
function esc(s) { return (s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function setRelay(ok) { const r = el('relay'); r.textContent = ok ? 'relais connecté' : 'relais déconnecté'; r.className = 'relay ' + (ok ? 'on' : 'off'); }

// Membres de la room sélectionnée autres que moi (cibles peek possibles).
function othersOf(room) { const r = room && state.rooms.get(room); return r ? r.roster.filter((m) => m.name !== state.me) : []; }
// Cible peek résolue pour une room : mémorisée si encore présente, sinon le 1er autre.
function resolvePeek(room) {
  const others = othersOf(room);
  if (!others.length) return null;
  const want = state.peekByRoom[room];
  return (want && others.some((m) => m.name === want)) ? want : others[0].name;
}
// Destinataire say résolu : 'all', un nom, ou null (personne). En 3+, défaut = 1 personne
// (jamais 'all' par défaut, pour ne pas réveiller tout le monde par accident).
function resolveSayTo(room) {
  const others = othersOf(room);
  if (!others.length) return null;
  if (others.length === 1) return 'all';            // 1-on-1 : "tous" = cette personne
  const want = state.sayToByRoom[room];
  if (want === 'all') return 'all';
  if (want && others.some((m) => m.name === want)) return want;
  return others[0].name;                            // défaut dirigé
}

// --- Rendu ---
function renderAll() { renderRooms(); renderRoster(); renderMyTerms(); renderCenter(); }

function renderRooms() {
  const ul = el('room-list'); ul.innerHTML = '';
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

function renderCenter() {
  el('chat-room').textContent = state.selected || '—';
  el('tab-chat').classList.toggle('active', state.tab === 'chat');
  el('tab-peek').classList.toggle('active', state.tab === 'peek');
  const peek = state.tab === 'peek';
  el('chat-view').classList.toggle('hidden', peek);
  el('peek-view').classList.toggle('hidden', !peek);
  if (peek) renderPeek(); else { renderChat(); renderSayTo(); }
}

// Barre "À :" — n'apparaît que s'il y a 2+ autres personnes (sinon pas de choix utile).
function renderSayTo() {
  const room = state.selected;
  const box = el('say-to');
  const others = othersOf(room);
  if (others.length <= 1) { box.innerHTML = ''; return; }
  const sel = resolveSayTo(room);
  box.innerHTML = '<span class="muted">À :</span>';
  const mk = (val, label) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toopt' + (sel === val ? ' active' : '');
    b.textContent = label;
    b.onclick = () => { state.sayToByRoom[room] = val; renderSayTo(); };
    box.appendChild(b);
  };
  for (const m of others) mk(m.name, m.name);
  mk('all', 'Tous');
}

function renderChat() {
  const box = el('messages');
  const room = state.selected && state.rooms.get(state.selected);
  if (!room || !room.chat.length) { box.innerHTML = '<div class="empty">(aucun message)</div>'; return; }
  box.innerHTML = room.chat.map((e) =>
    `<div class="msg"><span class="time">${hhmm(e.time)}</span><span class="from ${e.role === 'ai' ? 'ai' : 'human'}">${esc(e.from)}:</span>${esc(e.text)}</div>`
  ).join('');
  box.scrollTop = box.scrollHeight;
}

function renderPeek() {
  const room = state.selected;
  const others = othersOf(room);
  const target = resolvePeek(room);
  state.peekTarget = target;
  const tg = el('peek-targets');
  if (!others.length) {
    tg.innerHTML = '<span class="muted">personne à observer dans cette room</span>';
    el('peek').textContent = '';
  } else {
    tg.innerHTML = '';
    for (const m of others) {
      const b = document.createElement('button');
      b.className = 'ptarget' + (m.name === target ? ' active' : '');
      b.textContent = m.name;
      b.onclick = () => { state.peekByRoom[room] = m.name; renderPeek(); };
      tg.appendChild(b);
    }
  }
  applyPeek(room, target);
}

// (Re)lance ou arrête le poll peek côté hub selon l'onglet / la room / la cible.
function applyPeek(room, target) {
  if (state.tab !== 'peek' || !room || !target) {
    if (peekActive) { send({ cmd: 'peek-stop' }); peekActive = null; }
    return;
  }
  if (peekActive && peekActive.room === room && peekActive.target === target) return; // déjà en cours
  send({ cmd: 'peek-stop' });
  el('peek').textContent = '…';
  send({ cmd: 'peek', room, target });
  peekActive = { room, target };
}

function renderRoster() {
  const ul = el('roster'); ul.innerHTML = '';
  const room = state.selected && state.rooms.get(state.selected);
  if (!room || !room.roster.length) { ul.innerHTML = '<li class="empty">personne</li>'; return; }
  for (const m of room.roster) {
    const li = document.createElement('li');
    const mine = m.name === state.me;
    if (mine) li.className = 'me';
    li.innerHTML = `<span class="dot ${live(m) ? 'active' : ''}" title="${live(m) ? 'connecté · actif' : 'connecté'}">●</span>
      <span class="name ${m.role === 'ai' ? 'ai' : ''}">${esc(m.name)}</span>
      <span class="role">${esc(m.role)}</span>`;
    if (!mine) li.onclick = () => { state.peekByRoom[state.selected] = m.name; selectTab('peek'); };
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
  if (peekActive) { send({ cmd: 'peek-stop' }); peekActive = null; } // re-scopé à la nouvelle room
  renderAll();
}
function selectTab(tab) {
  state.tab = tab;
  if (tab !== 'peek' && peekActive) { send({ cmd: 'peek-stop' }); peekActive = null; }
  renderCenter();
}

// --- Branchements UI ---
el('tab-chat').onclick = () => selectTab('chat');
el('tab-peek').onclick = () => selectTab('peek');

el('say-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const inp = el('say-input');
  const raw = inp.value.trim();
  if (!raw || !state.selected) return;
  let text = raw, target, all = false;
  const mm = raw.match(/^@(\S+)\s+([\s\S]+)$/);
  if (mm) {
    text = mm[2];
    if (mm[1] === 'all' || mm[1] === 'tous') all = true; else target = mm[1];
  } else {
    const sel = resolveSayTo(state.selected);
    if (sel === 'all' || sel === null) all = true; else target = sel;
  }
  const payload = { cmd: 'say', room: state.selected, text };
  if (target) payload.target = target;
  if (all) payload.all = true;
  send(payload);
  inp.value = '';
});

el('btn-open').onclick = () => { if (!state.selected) return alert('Sélectionne une room.'); send({ cmd: 'open-terminal', room: state.selected }); };
el('btn-newroom').onclick = () => {
  const room = (prompt('Nom de la nouvelle room :') || '').trim();
  if (room) { send({ cmd: 'open-terminal', room }); state.selected = room; getRoom(room); renderAll(); }
};

connect();
