# Group Terminal 🖥️👥🤖

Un terminal partagé en temps réel pour travailler à plusieurs sur le même projet, avec un chat intégré où les IA peuvent observer, échanger et répondre.

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

## Lancement

### 1. Démarrer le serveur

```bash
npm start
```

Par défaut le serveur écoute sur `ws://localhost:4242`.

### 2. Se connecter en tant qu'humain

Dans un autre terminal :

```bash
npm run client -- alice
# ou
NAME=alice npm run client
```

Dans un troisième terminal :

```bash
npm run client -- bob
```

### 3. Connecter une IA

```bash
npm run ai -- alice-bot
# ou
NAME=alice-bot npm run ai
```

## Commandes disponibles

| Commande | Description |
|----------|-------------|
| `/msg <texte>` | Envoyer un message dans le chat de groupe |
| `/peek <nom>` | Afficher les dernières lignes du terminal de `<nom>` |
| `/who` | Liste des participants connectés |
| `/help` | Afficher l'aide |
| `/quit` | Quitter |

## Interactions IA

Dans le chat, un message contenant `@<nom-de-l-ia>` déclenche une réponse de l'IA. Exemples :

```
/msg @alice-bot quels sont les fichiers modifiés ?
/msg @alice-bot sur quelle branche tu es ?
/msg @alice-bot derniers commits ?
```

L'IA exécute la commande correspondante **sur son propre poste** et répond dans le chat.

## Architecture

```
┌─────────────┐      WebSocket       ┌─────────────┐
│   alice     │◄────────────────────►│   serveur   │
│  (humain)   │                      │  (relai)    │
└─────────────┘                      └──────┬──────┘
                                            │
┌─────────────┐      WebSocket             │
│    bob      │◄───────────────────────────┤
│  (humain)   │                            │
└─────────────┘                            │
                                           │
┌─────────────┐      WebSocket             │
│  alice-bot  │◄───────────────────────────┘
│    (IA)     │
└─────────────┘
```

## Limitations actuelles (MVP)

- Le client utilise `readline` + `exec` : on a un shell simplifié, pas un vrai terminal interactif avec flèches/tabulation.
- Les commandes `cd` ne persistent pas d'une ligne à l'autre.
- Pas de chiffrement : tout passe en clair sur WebSocket (`ws://`).
- Pas d'authentification.

## Prochaines étapes possibles

- Vrai shell interactif avec `node-pty` et une TUI (`ink` ou `blessed`).
- Mode "observeur" passif pour les IA.
- Historique de chat persistant.
- Authentification par token.
- Transport chiffré (`wss://`).
- Canal privé entre deux participants.
