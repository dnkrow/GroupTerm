# CLAUDE.md — GroupTerm

Contexte pour toute session Claude travaillant sur ce dépôt.

## C'est quoi

**GroupTerm** : terminal partagé en réseau pour bosser à deux (ou +) sur le même projet, chacun sur sa machine. Chaque personne (et son IA) peut voir le terminal de l'autre et lui parler via 3 commandes shell : `peek`, `say`, `chat`. Pensé pour le pair-coding humain+IA (les IA peuvent appeler ces commandes elles-mêmes).

Inspiré de DuoTerm (app Electron mono-machine) ; ici c'est **réseau** (serveur relais + clients sur des PC différents).

## Architecture

```
PC A (gt.js) ◄──WebSocket──► serveur (relais) ◄──WebSocket──► PC B (gt.js)
```

- **`server.js`** — relais WebSocket (port `4242`). Tient un **émulateur de terminal `@xterm/headless` par membre**, alimenté par son flux : `peek` renvoie l'**écran rendu** (propre, même face à un TUI comme Claude Code), pas le flux brut. Tient aussi le transcript `chat` par room. Connexions éphémères type `tool` pour peek/say/chat ; livraison des `say` via message `deliver`.
- **`gt.js`** — client principal. Lance le shell de l'utilisateur en **passthrough transparent** (rendu natif), diffuse sa sortie au serveur (`terminal`), injecte `peek`/`say`/`chat` dans le `PATH` (via shims générés dans `%TEMP%/groupterm/bin`), et injecte les `say` entrants dans le pty via **bracketed paste** (`\x1b[200~…\x1b[201~` + `\r`) pour réveiller l'IA cible. Lancement : `node gt.js <nom> <room> [role]`.
- **`gt-tool.js`** — implémentation one-shot derrière les commandes (ouvre une connexion courte, envoie `{type:'tool',cmd,...}`, affiche la réponse, ferme). Lit `GT_SERVER`/`GT_ROOM`/`GT_NAME` dans l'environnement.
- **`gt-launch.ps1`** — lanceur Windows : mémorise nom/room/serveur dans `%USERPROFILE%\.groupterm.json`, démarre le serveur local si le serveur pointe vers ce PC (localhost ou une IP locale), puis lance `gt.js`.
- **`install.ps1` / `uninstall.ps1`** — raccourci Bureau + clic droit « Ouvrir GroupTerm ici » (registre HKCU, sans admin).

## Protocole WebSocket (résumé)

- Client membre → serveur : `register{name,role,room,cols,rows}`, `terminal{data}`, `resize{cols,rows}`.
- Outil → serveur : `tool{cmd:'peek'|'say'|'chat', room, from, target?, text?, n?}` → réponse `tool-result{ok,text}`.
- Serveur → client membre : `deliver{from,text}` (un `say` à injecter), `system{text}`.

## Variables d'environnement

`GT_SERVER` (déf. `ws://localhost:4242`), `GT_ROOM` (déf. `default`), `GT_NAME`, `GT_ROLE` (`human`/`ai`), `PORT` (serveur).

## Tests

```bash
npm test             # test-say-peek.js : peek/say/chat (livraison, transcript, cibles)
npm run test:wrapper # test-wrapper.js : le wrapper diffuse + reçoit les say (héberge gt.js dans un pty)
```
Les tests prennent `SERVER` en env (défaut `ws://localhost:4343`) — lance un serveur de test sur un port à part pour ne pas toucher au live.

## Conventions

- Dépendances volontairement minimales : `@xterm/headless`, `node-pty`, `ws`. (Anciennement blessed/chalk/term.js — supprimés.)
- Textes d'interface en **français**.
- `node_modules` est gitignore (ne pas le re-committer).
- Côté hôte, le serveur doit pointer « ce PC » (champ serveur vide dans le lanceur) ; le binôme met l'IP de l'hôte.

## Pièges connus

- `peek` reconstruit l'écran via l'émulateur : la ligne de saisie en cours de composition d'un TUI peut rester volatile (négligeable).
- Pas d'auth ni de chiffrement applicatif → usage via Tailscale (chiffré) ou LAN de confiance uniquement.

## Pistes non faites

Verrou de tour de parole strict, `wss://` + auth par token, ciblage multi-personnes plus riche.
