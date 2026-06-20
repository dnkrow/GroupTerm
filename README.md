# group-terminal 🖥️🤝🤖

Terminal **partagé en réseau** pour bosser à deux (ou plus) sur le même projet — chacun sur sa machine, sur sa branche — où **toi et ton IA pouvez jeter un œil au terminal de l'autre et lui parler en direct**, via 3 simples commandes : `peek`, `say`, `chat`.

Inspiré de DuoTerm. Différence clé : DuoTerm est mono-machine (2 panneaux locaux), **group-terminal est réseau** (chacun sur son PC, reliés par un serveur).

## Concept

Tu lances `gt.js` à la place de ton terminal habituel. Ça démarre ton shell **normal** (rendu natif, rien n'est re-dessiné) et ça ajoute, dans ton PATH, 3 commandes qui parlent au serveur partagé :

| Commande | Effet |
|----------|-------|
| `peek` | Affiche l'écran du binôme (rendu propre, même s'il a un TUI comme Claude Code) |
| `peek alice -n 100` | 100 dernières lignes d'une personne précise |
| `say "message"` | Écrit le message **dans le terminal de l'autre** (apparaît comme un input → réveille son IA) |
| `say --to alice "..."` | Cible une personne précise |
| `chat` | Affiche l'historique propre de la conversation |

Comme ce sont de **vraies commandes shell**, elles marchent aussi bien pour toi que pour une IA (Claude Code, etc.) tournant dans le terminal : ton IA peut faire `peek`/`say`/`chat` toute seule.

## Installation

```bash
npm install
```

## Utilisation

### 1. Démarrer le serveur (une seule fois, n'importe où sur le réseau)

```bash
npm start
```

Écoute sur `ws://localhost:4242`. Pour exposer sur le réseau, les autres pointent vers ton IP via `GT_SERVER` (voir plus bas).

### 2. Chaque personne lance son terminal partagé

```bash
# Toi
node gt.js alice notre-projet

# Ton pote (sur son PC)
node gt.js bob notre-projet
```

Format : `node gt.js <nom> <room> [role]`. Tu te retrouves dans ton shell normal, avec `peek`/`say`/`chat` disponibles.

### 3. Lance ton IA dedans (optionnel)

Dans la fenêtre `gt.js`, lance `claude` (ou autre). Ton IA hérite des commandes : elle peut `peek` le terminal du binôme et lui `say` des messages.

## Variables d'environnement

| Variable | Défaut | Rôle |
|----------|--------|------|
| `GT_SERVER` | `ws://localhost:4242` | URL du serveur (mettre l'IP de l'hôte pour le réseau) |
| `GT_ROOM` | `default` | Room (espace isolé) |
| `GT_NAME` | argument | Ton nom |
| `GT_ROLE` | `human` | `human` ou `ai` |
| `PORT` | `4242` | Port du serveur |

Exemple réseau :

```bash
GT_SERVER=ws://192.168.1.20:4242 node gt.js alice notre-projet
```

## Rooms

Chaque groupe a sa room isolée (messages + écrans séparés) :

```bash
node gt.js alice projet-secret
node gt.js bob   projet-secret
```

## Superviser à distance

Comme chaque terminal est diffusé au serveur, tu peux jeter un œil aux deux côtés depuis n'importe où, sans déranger, en appelant directement la commande-outil :

```bash
GT_SERVER=ws://localhost:4242 GT_ROOM=notre-projet GT_NAME=superviseur node gt-tool.js peek alice
GT_SERVER=ws://localhost:4242 GT_ROOM=notre-projet GT_NAME=superviseur node gt-tool.js chat
```

## Architecture

```
   PC d'Alice                         PC de Bob
 ┌───────────────┐                  ┌───────────────┐
 │  gt.js        │   WebSocket      │  gt.js        │
 │  ├ ton shell  │◄───────────────► │  ├ ton shell  │
 │  └ peek/say/  │     serveur      │  └ peek/say/  │
 │    chat (PATH)│   (relais +      │    chat (PATH)│
 └───────────────┘    émulateur     └───────────────┘
                      par membre)
```

- **`server.js`** — relais WebSocket. Garde un **émulateur de terminal (`@xterm/headless`) par membre**, alimenté par son flux : `peek` renvoie l'écran *rendu* (propre), pas le flux brut. Stocke aussi le transcript du `chat` par room.
- **`gt.js`** — wrapper : lance ton shell en passthrough transparent, diffuse sa sortie au serveur, injecte `peek`/`say`/`chat` dans le PATH, et injecte les `say` entrants via *bracketed paste* (`\x1b[200~…\x1b[201~`) pour réveiller l'IA cible.
- **`gt-tool.js`** — implémentation one-shot derrière `peek`/`say`/`chat`.

## Tests

```bash
npm test             # flux say/peek/chat (livraison, transcript, cibles)
npm run test:wrapper # le wrapper diffuse bien + reçoit les say injectés
```

## Limitations / pistes

- Pas d'authentification ni de chiffrement (`ws://` en clair) → réseau de confiance uniquement. Piste : token + `wss://`.
- La ligne de saisie en cours de composition d'un TUI peut rester volatile dans `peek` (négligeable).
- Pas de verrou de tour de parole strict (les `say` simultanés sont possibles). Piste : alternance optionnelle.
