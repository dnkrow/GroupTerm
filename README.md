# Group Terminal 🖥️👥🤖

Un terminal partagé en temps réel pour travailler à plusieurs sur le même projet, avec un chat intégré où les IA peuvent observer et échanger.

## Concept

Tu bosses avec un pote sur un projet. Chacun est sur sa branche, dans son terminal, mais vous voulez :
- voir en direct ce que l'autre fait,
- discuter dans le terminal,
- laisser vos IA observer et intervenir quand on les sollicite.

Group Terminal relie tous les terminaux via WebSocket et diffuse :
- les sorties de commandes,
- les messages de chat,
- les demandes de "peek" (jeter un œil au terminal de l'autre).

## Installation

```bash
npm install
```

## Lancement rapide

### 1. Démarrer le serveur

```bash
npm start
```

Par défaut le serveur écoute sur `ws://localhost:4242`.

### 2. Se connecter avec le client TUI (recommandé)

Dans un vrai terminal (pas un pipe) :

```bash
# Alice
npm run client:tui -- alice ma-room

# Bob (dans un autre terminal)
npm run client:tui -- bob ma-room
```

Le client TUI affiche :
- en haut : ton vrai shell PowerShell/Bash interactif (node-pty),
- en bas : le chat + l'activité de l'autre.

**Raccourcis :**
- `Tab` : passer en mode chat / revenir au terminal
- `Entrée` (en mode chat) : envoyer le message
- `Esc` (en mode chat) : annuler
- `Ctrl+C` : quitter

### 3. Client simple (fallback sans TUI)

Si le TUI ne marche pas dans ton environnement :

```bash
npm run client -- alice ma-room
```

C'est un client readline + exec : moins interactif mais fonctionne partout.

### 4. Connecter une IA

```bash
npm run ai -- alice-bot ma-room
```

## Commandes disponibles

Dans le chat (client TUI ou client simple) :

| Commande | Description |
|----------|-------------|
| `/msg <texte>` | Envoyer un message dans le chat de groupe |
| `/peek <nom>` | Afficher les dernières lignes du terminal de `<nom>` |
| `/who` | Liste des participants connectés |
| `/help` | Afficher l'aide |
| `/quit` | Quitter |

Un message simple (sans `/`) est aussi envoyé dans le chat.

## Interactions IA

Dans le chat, un message contenant `@<nom-de-l-ia>` déclenche une réponse de l'IA. Exemples :

```
/msg @alice-bot quels sont les fichiers modifiés ?
/msg @alice-bot sur quelle branche tu es ?
/msg @alice-bot derniers commits ?
```

L'IA exécute la commande correspondante **sur son propre poste** et répond dans le chat.

## Rooms / canaux

Chaque groupe a sa propre room. Les messages et l'historique sont isolés par room.

```bash
npm run client:tui -- alice projet-secret
npm run ai -- bot-projet projet-secret
```

Quand tu rejoins une room, tu récupères automatiquement :
- les derniers messages de chat,
- les dernières sorties de terminal des participants.

## Architecture

```
                    WebSocket
   alice ───────┐              ┌─────── bob
  (client TUI)   │              │  (client TUI)
                 │◄────────────►│
   alice-bot ────┤   serveur    ├────── bob-bot
      (IA)       │   (relai)    │      (IA)
                 │              │
                 └──────────────┘
                 rooms + historique
```

## Tests

```bash
# Tests fonctionnels (serveur doit être démarré)
npm test

# Test du client TUI dans un pseudo-terminal (serveur doit être démarré)
npm run test:tui
```

## Limitations actuelles (MVP)

- Le client TUI affiche le shell local dans un `blessed.box` : les commandes fonctionnent, mais le rendu ANSI/couleurs/curseur est basique.
- Pas de chiffrement : tout passe en clair sur WebSocket (`ws://`).
- Pas d'authentification.

## Prochaines étapes possibles

- Vrai émulateur de terminal dans le client TUI (xterm.js ou blessed.terminal bien intégré).
- Mode "observeur" passif pour les IA.
- Authentification par token.
- Transport chiffré (`wss://`).
- Canal privé entre deux participants.
- Partage de fichiers / snippets.
