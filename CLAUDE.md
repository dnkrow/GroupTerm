# CLAUDE.md — GroupTerm

Contexte pour toute session Claude travaillant sur ce dépôt.

## C'est quoi

**GroupTerm** : terminal partagé en réseau pour bosser à deux (ou +) sur le même projet, chacun sur sa machine. Chaque personne (et son IA) peut voir le terminal de l'autre et lui parler via 3 commandes shell : `peek`, `say`, `chat`. Pensé pour le pair-coding humain+IA (les IA peuvent appeler ces commandes elles-mêmes).

Inspiré de DuoTerm (app Electron mono-machine) ; ici c'est **réseau** (serveur relais + clients sur des PC différents).

## Architecture

```
PC A (gt.js) ◄──WebSocket──► serveur (relais) ◄──WebSocket──► PC B (gt.js)
   ▲                                                              ▲
   │ watch{scope:'all'}                          watch{scope:'all'} │
navigateur ◄─► gt-hub (PC A)                       gt-hub (PC B) ◄─► navigateur
```

- **`server.js`** — relais WebSocket (port `4242`). Tient un **émulateur de terminal `@xterm/headless` par membre**, alimenté par son flux : `peek` renvoie l'**écran rendu** (propre, même face à un TUI comme Claude Code), pas le flux brut. Tient aussi le transcript `chat` par room. Connexions éphémères type `tool` pour peek/say/chat/who ; livraison des `say` via message `deliver`. Pousse en plus présence + chat aux **watchers** (tableaux de bord) : `snapshot` à l'abonnement, puis `roster` (présence, avec `lastActivity`) et `chat-event` en direct ; un tick périodique (~3 s) rafraîchit le live/idle.
- **`gt.js`** — client principal. Lance le shell de l'utilisateur en **passthrough transparent** (rendu natif), diffuse sa sortie au serveur (`terminal`), injecte `peek`/`say`/`chat`/`who` dans le `PATH` (via shims générés dans `%TEMP%/groupterm/bin`), et injecte les `say` entrants dans le pty via **bracketed paste** (`\x1b[200~…\x1b[201~` + `\r`) pour réveiller l'IA cible. Chaque ligne injectée est préfixée par `# ` : si aucune IA ne tourne et que le message arrive à un prompt nu (PowerShell/bash), c'est un commentaire → pas d'exécution ni d'erreur ; Claude Code le lit normalement (le `#` n'est ajouté qu'à l'injection, pas au transcript). Lancement : `node gt.js <nom> <room> [role]`.
- **`gt-hub.js`** — **hub web (centre de contrôle), un par PC**. Tourne localement : sert la page (`public/`) sur `http://localhost:4243`, ouvre le navigateur par défaut, se connecte au relais en `watch{scope:'all'}` (toutes les rooms), et **exécute les actions locales** (spawn/fermeture de terminaux `gt.js`) demandées par la page. Pont navigateur (WS local) ↔ relais. Nécessaire car une page web ne peut pas lancer de process sur le PC. Deps : `http`+`child_process` (intégrés) + `ws`. Lit `GT_SERVER`/`GT_NAME`/`GT_CWD`/`HUB_PORT`. Lancement : `node gt-hub.js [nom]`.
- **`public/`** — la page du hub (vanilla, aucun build) : `index.html` (rooms / chat / roster / peek / mes terminaux), `app.js` (WS vers le hub local + rendu + commandes), `app.css` (thème sombre).
- **`gt-dash.js`** — **tableau de bord TUI** (alternative terminal, `npm run dash`). Client `ws` en ANSI pur : s'abonne via `watch{room}`, affiche roster (● live/idle) + fil de chat + ligne `say>`. Lit `GT_SERVER`/`GT_ROOM`/`GT_NAME`. Lancement : `node gt-dash.js [nom] [room]`.
- **`gt-tool.js`** — implémentation one-shot derrière les commandes (ouvre une connexion courte, envoie `{type:'tool',cmd,...}`, affiche la réponse, ferme). `cmd` ∈ peek/say/chat/**who**. Lit `GT_SERVER`/`GT_ROOM`/`GT_NAME` dans l'environnement.
- **`gt-launch.ps1`** — lanceur Windows : mémorise **plusieurs connexions (profils)** dans `%USERPROFILE%\.groupterm.json` (`{profiles:[{name,room,server}], last}` ; migre l'ancien format mono-objet), propose un **menu** si ≥ 2 profils (Entrée = rouvrir le dernier), démarre le serveur local si le serveur pointe vers ce PC, affiche un **bloc d'état** (qui tu es / serveur / qui est déjà là, via `who`), démarre le **hub web** s'il ne tourne pas déjà (un par PC, port 4243 ; `-nodash` pour s'en passer), puis lance `gt.js`. `-setup` ajoute une connexion. **`-stop`** ferme tes `gt.js` + le hub (relais gardé) ; **`-stopall`** coupe aussi le relais (déconnecte le binôme, avec confirmation). Le relais est lancé en **chemin complet** pour être identifiable à l'arrêt ; `-stopall` cible en plus le process qui écoute sur le port 4242. `install.ps1` crée 3 raccourcis Bureau : GroupTerm, Réglages, **Arrêter** (= `-stop`).
- **`install.ps1` / `uninstall.ps1`** — raccourci Bureau + clic droit « Ouvrir GroupTerm ici » (registre HKCU, sans admin).

## Protocole WebSocket (résumé)

- Client membre → serveur : `register{name,role,room,cols,rows}`, `terminal{data}`, `resize{cols,rows}`.
- Outil → serveur : `tool{cmd:'peek'|'say'|'chat'|'who'|'quit', room, from, target?, text?, n?, all?}` → réponse `tool-result{ok,text}`. (`quit` → délivre `{type:'quit'}` au membre ciblé. Pour `say` : à 2+ autres membres sans `target`, refusé sauf `all:true` — évite de réveiller toutes les IA.)
- Watcher → serveur : `watch{room,name}` (TUI, une room) ou `watch{scope:'all',name}` (hub web, toutes les rooms).
- Serveur → client membre : `deliver{from,text}` (un `say` à injecter), `quit{}` (fermeture demandée), `system{text}`.
- Serveur → watcher : `snapshot{room,roster,chat}` (abonnement room), `rooms-snapshot{rooms:[{room,roster,chat}]}` (abonnement global), `roster{room,members:[{name,role,lastActivity}]}`, `chat-event{room,from,role,text,time}`.
- Hub local ↔ navigateur (WS sur localhost) : navigateur → `{cmd:'say'|'peek'|'peek-stop'|'open-terminal'|'close-terminal', room, ...}` ; hub → `hello`, `rooms-snapshot`, `roster`, `chat-event`, `peek{room,target,text}`, `relay{connected}`.

## Variables d'environnement

`GT_SERVER` (déf. `ws://localhost:4242`), `GT_ROOM` (déf. `default`), `GT_NAME`, `GT_ROLE` (`human`/`ai`), `PORT` (serveur).

## Tests

```bash
npm test             # test-say-peek.js : peek/say/chat (livraison, transcript, cibles)
npm run test:wrapper # test-wrapper.js : le wrapper diffuse + reçoit les say (héberge gt.js dans un pty)
npm run test:dash    # test-dash.js : watch/snapshot/roster/chat-event + commande who
npm run test:hub     # test-hub.js : watch{scope:'all'}/rooms-snapshot/chat-event taggué + quit
```
Le hub web (`gt-hub.js` + `public/`) se vérifie manuellement : `node server.js` puis `node gt-hub.js <nom>` (ouvre le navigateur). Pour ne pas ouvrir le navigateur en test : `GT_NO_BROWSER=1`.
Les tests prennent `SERVER` en env (défaut `ws://localhost:4343`) — lance un serveur de test sur un port à part pour ne pas toucher au live.

## Conventions

- Dépendances volontairement minimales : `@xterm/headless`, `node-pty`, `ws`. (Anciennement blessed/chalk/term.js — supprimés.)
- Textes d'interface en **français**.
- `node_modules` est gitignore (ne pas le re-committer).
- Côté hôte, le serveur doit pointer « ce PC » (champ serveur vide dans le lanceur) ; le binôme met l'IP de l'hôte.

## Pièges connus

- **Relais/hub = process longue durée.** Après avoir édité `server.js` ou `gt-hub.js`, il faut **tuer et relancer** le process concerné, sinon l'ancien code continue de tourner (symptôme vécu : 5 `node server.js` empilés, le plus vieux gardait le port 4242 → dashboard vide / room fantôme). Désormais : `server.js` sort proprement si le port est déjà pris (pas de zombie), et le lanceur **relance toujours un hub frais**. Le relais, lui, est réutilisé s'il tourne (pour ne pas déconnecter le binôme) → à redémarrer manuellement après une modif de `server.js`.
- `peek` reconstruit l'écran via l'émulateur : la ligne de saisie en cours de composition d'un TUI peut rester volatile (négligeable).
- Pas d'auth ni de chiffrement applicatif → usage via Tailscale (chiffré) ou LAN de confiance uniquement.

## Pistes non faites

Verrou de tour de parole strict, `wss://` + auth par token, ciblage multi-personnes plus riche.
