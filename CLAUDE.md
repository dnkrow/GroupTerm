# CLAUDE.md — GroupTerm

Contexte pour toute session Claude travaillant sur ce dépôt.

## C'est quoi

**GroupTerm** : terminal partagé en réseau pour bosser à deux (ou +) sur le même projet, chacun sur sa machine. Chaque personne (et son IA) peut voir le terminal de l'autre et lui parler via des commandes shell : `peek`, `say`, `chat`, `who` (communication) + `recrute`/`libere` (orchestration : ouvrir/fermer un agent Claude briefé). Pensé pour le pair-coding humain+IA (les IA peuvent appeler ces commandes elles-mêmes).

En plus des commandes, un **hub web** (`gt-hub` + `public/`, un par PC) sert un **centre de contrôle** dans le navigateur : voir toutes les rooms et leur présence en direct, lire/écrire le chat, observer l'écran d'un membre (onglet peek), et ouvrir/fermer des terminaux sur sa machine.

Inspiré de DuoTerm (app Electron mono-machine) ; ici c'est **réseau** (serveur relais + clients sur des PC différents).

**Mode solo (deux IA sur un seul PC).** Comme tout passe par le relais WebSocket, on peut faire dialoguer **deux Claude sur la même machine** : deux clients `gt.js` dans la même room avec des **noms distincts** (ex. `claude-a`/`claude-b` dans `#solo`). À 2 membres, chacun n'a qu'un seul « autre » → la règle anti-réveil ne s'applique pas, donc `say "..."` sans cible marche directement entre eux. Le plus simple : depuis le hub web, bouton **« ＋ Terminal nommé… »** (room + nom, ouverts en `role:'ai'`) ; puis lancer `claude` dans chaque fenêtre. Le hub sert de centre de contrôle (chat, peek de chaque IA, fermeture par nom). En CLI directe : `node gt.js claude-a solo ai` dans une fenêtre, `node gt.js claude-b solo ai` dans une autre.

**Mode orchestrateur (le cerveau recrute des spécialistes).** Une IA dans un terminal GroupTerm peut **ouvrir elle-même** un nouveau terminal d'agent Claude, briefé sur une mission, via la commande **`recrute <nom> [--yolo|--safe] <mission>`**. Ça écrit un briefing (`.groupterm/agents/<nom>.md` : rôle générique + mission), ouvre une fenêtre `gt.js <nom> <room> ai` et y démarre `claude` (par défaut `--permission-mode acceptEdits` ; `--yolo` = `bypassPermissions`, `--safe` = `default`) avec un prompt « lis ton briefing et exécute ». Le nouvel agent rejoint la room → le recruteur le pilote avec `say --to <nom>` / `peek <nom>`, et le ferme avec **`libere <nom>`** (= `quit`). Garde-fous : nom unique vérifié, **plafond** `GT_MAX_AGENTS` (défaut 6) refusé si dépassé, recrutement de soi-même interdit. Usage type : un Claude « cerveau » qui découpe le travail recrute un `design`/`qa`/`backend` à la volée, le dirige, puis le libère. Repose sur `GT_INIT` (commande tapée automatiquement au démarrage du shell de `gt.js`). ⚠️ Puissant : `--yolo` = exécution de code en cascade sans validation humaine ; chaque agent = une session Claude de plus (coût).

## Architecture

```
PC A (gt.js) ◄──WebSocket──► serveur (relais) ◄──WebSocket──► PC B (gt.js)
   ▲                                                              ▲
   │ watch{scope:'all'}                          watch{scope:'all'} │
navigateur ◄─► gt-hub (PC A)                       gt-hub (PC B) ◄─► navigateur
```

- **`server.js`** — relais WebSocket (port `4242`). Tient un **émulateur de terminal `@xterm/headless` par membre**, alimenté par son flux : `peek` renvoie l'**écran rendu** (propre, même face à un TUI comme Claude Code), pas le flux brut. Tient aussi le transcript `chat` par room. Connexions éphémères type `tool` pour peek/say/chat/who ; livraison des `say` via message `deliver`. Pousse en plus présence + chat aux **watchers** (tableaux de bord) : `snapshot` à l'abonnement, puis `roster` (présence, avec `lastActivity`) et `chat-event` en direct ; un tick périodique (~3 s) rafraîchit le live/idle.
- **`gt.js`** — client principal. Lance le shell de l'utilisateur en **passthrough transparent** (rendu natif), diffuse sa sortie au serveur (`terminal`), injecte `peek`/`say`/`chat`/`who` dans le `PATH` (via shims générés dans `%TEMP%/groupterm/bin`), et injecte les `say` entrants dans le pty via **bracketed paste** (`\x1b[200~…\x1b[201~` + `\r`) pour réveiller l'IA cible. Les injections sont **sérialisées** (une file `deliverChain`) : deux `say` rapprochés ne se mélangent jamais, ils passent l'un après l'autre dans l'ordre d'arrivée. Chaque message porte une **enveloppe d'identification** : une 1ʳᵉ ligne `[GroupTerm] message de <from>` (+ ` (à tous)` si diffusion, d'après le champ `alone` du `deliver`) — l'IA réceptrice sait qui parle et si on l'attend. Chaque ligne injectée (en-tête compris) est préfixée par `# ` : si aucune IA ne tourne et que le message arrive à un prompt nu (PowerShell/bash), c'est un commentaire → pas d'exécution ni d'erreur ; Claude Code le lit normalement (le `#` et l'en-tête ne sont ajoutés qu'à l'injection, pas au transcript). Shims injectés dans le PATH : `peek`/`say`/`chat`/`who` + **`recrute`/`libere`** (orchestration). Variable **`GT_INIT`** : si définie, une commande tapée automatiquement dans le shell ~1,5 s après le démarrage (sert au recrutement : démarrer `claude` briefé sans frappe humaine) ; consommée par `gt.js`, non propagée au shell enfant. Lancement : `node gt.js <nom> <room> [role]`.
- **`gt-hub.js`** — **hub web (centre de contrôle), un par PC**. Tourne localement : sert la page (`public/`) sur `http://localhost:4243`, ouvre le navigateur par défaut, se connecte au relais en `watch{scope:'all'}` (toutes les rooms), et **exécute les actions locales** (spawn/fermeture de terminaux `gt.js`) demandées par la page. `open-terminal` accepte un **`name` (+ `role`)** : un même PC peut donc lancer **plusieurs terminaux distincts dans une même room** (cf. mode solo) ; sans nom, on retombe sur le nom du hub. Le hub tient la liste des terminaux qu'il a lancés (`launched`) et la pousse au navigateur (`my-terms`) pour le pied de page « Mes terminaux » ; `close-terminal` cible le terminal **par nom**. Pont navigateur (WS local) ↔ relais. Nécessaire car une page web ne peut pas lancer de process sur le PC. Deps : `http`+`child_process` (intégrés) + `ws`. Lit `GT_SERVER`/`GT_NAME`/`GT_CWD`/`HUB_PORT`. Lancement : `node gt-hub.js [nom]`.
- **`public/`** — la page du hub (vanilla, aucun build) : `index.html` (rooms / chat / roster / peek / mes terminaux), `app.js` (WS vers le hub local + rendu + commandes), `app.css` (thème sombre).
- **`gt-dash.js`** — **tableau de bord TUI** (alternative terminal, `npm run dash`). Client `ws` en ANSI pur : s'abonne via `watch{room}`, affiche roster (● live/idle) + fil de chat + ligne `say>`. Lit `GT_SERVER`/`GT_ROOM`/`GT_NAME`. Lancement : `node gt-dash.js [nom] [room]`.
- **`gt-tool.js`** — implémentation one-shot derrière les commandes. Pour `peek`/`say`/`chat`/`who`/`libere` : ouvre une connexion courte, envoie `{type:'tool',cmd,...}` (`libere` → `quit`), affiche la réponse, ferme. Pour **`recrute`** (action **locale**, pas un échange relais) : vérifie nom libre + plafond via `who`, écrit le briefing `.groupterm/agents/<nom>.md`, puis ouvre une fenêtre terminal `gt.js <nom> <room> ai` avec `GT_INIT` qui démarre `claude`. Lit `GT_SERVER`/`GT_ROOM`/`GT_NAME`/`GT_MAX_AGENTS` dans l'environnement.
- **`gt-launch.ps1`** — lanceur Windows : mémorise **plusieurs connexions (profils)** dans `%USERPROFILE%\.groupterm.json` (`{profiles:[{name,room,server}], last}` ; migre l'ancien format mono-objet), propose un **menu** si ≥ 2 profils (Entrée = rouvrir le dernier), démarre le serveur local si le serveur pointe vers ce PC, affiche un **bloc d'état** (qui tu es / serveur / qui est déjà là, via `who`), démarre le **hub web** s'il ne tourne pas déjà (un par PC, port 4243 ; `-nodash` pour s'en passer), puis lance `gt.js`. `-setup` ajoute une connexion. **`-stop`** ferme tes `gt.js` + le hub (relais gardé) ; **`-stopall`** coupe aussi le relais (déconnecte le binôme, avec confirmation). Le relais est lancé en **chemin complet** pour être identifiable à l'arrêt ; `-stopall` cible en plus le process qui écoute sur le port 4242. `install.ps1` crée 3 raccourcis Bureau : GroupTerm, Réglages, **Arrêter** (= `-stop`).
- **`install.ps1` / `uninstall.ps1`** — raccourci Bureau + clic droit « Ouvrir GroupTerm ici » (registre HKCU, sans admin).
- **`COLLAB.md`** — guide de collaboration **à donner à chaque IA** d'une session partagée (reconnaître un message entrant, à qui répondre, finir sa tâche avant de réagir, annoncer/accuser réception). C'est le pendant « comportement » de l'enveloppe d'identification : le transport livre proprement avec le contexte, le guide dit à l'IA comment s'en servir pour ne pas se perdre.

## Protocole WebSocket (résumé)

- Client membre → serveur : `register{name,role,room,cols,rows}`, `terminal{data}`, `resize{cols,rows}`.
- Outil → serveur : `tool{cmd:'peek'|'say'|'chat'|'who'|'quit', room, from, target?, text?, n?, all?}` → réponse `tool-result{ok,text}`. (`quit` → délivre `{type:'quit'}` au membre ciblé. Pour `say` : à 2+ autres membres sans `target`, refusé sauf `all:true` — évite de réveiller toutes les IA.)
- Watcher → serveur : `watch{room,name}` (TUI, une room) ou `watch{scope:'all',name}` (hub web, toutes les rooms).
- Serveur → client membre : `deliver{from,text,alone}` (un `say` à injecter ; `alone:false` = diffusé à plusieurs → l'injection affiche « (à tous) »), `quit{}` (fermeture demandée), `system{text}`.
- Serveur → watcher : `snapshot{room,roster,chat}` (abonnement room), `rooms-snapshot{rooms:[{room,roster,chat}]}` (abonnement global), `roster{room,members:[{name,role,lastActivity}]}`, `chat-event{room,from,role,text,time}`.
- Hub local ↔ navigateur (WS sur localhost) : navigateur → `{cmd:'say'|'peek'|'peek-stop'|'open-terminal'|'close-terminal', room, name?, role?, ...}` (`name`/`role` pour ouvrir/fermer un terminal nommé) ; hub → `hello`, `rooms-snapshot`, `my-terms{terms:[{room,name,role}]}`, `roster`, `chat-event`, `peek{room,target,text}`, `relay{connected}`.

## Variables d'environnement

`GT_SERVER` (déf. `ws://localhost:4242`), `GT_ROOM` (déf. `default`), `GT_NAME`, `GT_ROLE` (`human`/`ai`), `PORT` (serveur), `GT_INIT` (commande auto-tapée au démarrage de `gt.js` ; utilisée par `recrute`), `GT_MAX_AGENTS` (plafond d'agents par room pour `recrute`, déf. 6).

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
