# GroupTerm 🖥️🤝🤖

**Terminal partagé en réseau** pour travailler à deux (ou plus) sur le même projet — chacun sur sa machine, sur sa branche. Toi **et ton IA** (Claude Code, etc.) pouvez jeter un œil au terminal de l'autre et lui parler en direct, via 3 commandes : **`peek`**, **`say`**, **`chat`**.

Pensé pour le pair-coding où chacun a son assistant IA : les deux IA peuvent se coordonner toutes seules en s'observant et en se parlant.

---

## Le principe

Tu lances `GroupTerm` au lieu de ton terminal habituel. Tu obtiens **ton shell normal** (rendu natif, rien n'est re-dessiné), avec en plus 3 commandes disponibles dans le terminal :

| Commande | Effet |
|----------|-------|
| `peek` | Affiche l'écran de ton binôme (propre, même s'il fait tourner un TUI comme Claude Code) |
| `peek bob -n 100` | 100 dernières lignes d'une personne précise |
| `say "message"` | Écrit le message **dans le terminal de l'autre** — il y apparaît comme une saisie, ce qui réveille son IA (préfixé `#` : sans IA lancée, c'est un commentaire inoffensif au prompt) |
| `say --to bob "..."` | Cible une personne précise |
| `chat` | Affiche l'historique propre de la conversation |
| `who` | Liste qui est dans la room, avec son état (live / idle) |

Comme ce sont de **vraies commandes shell**, elles marchent pour toi comme pour une IA tournant dans le terminal : ton IA peut faire `peek` / `say` / `chat` / `who` d'elle-même.

---

## Le hub web (centre de contrôle)

Dès qu'on travaille sur **plusieurs terminaux / plusieurs rooms**, ça devient vite le bazar. Le **hub** est une **page web** (ouverte dans ton navigateur) qui te donne une vue d'ensemble et te laisse tout piloter :

```bash
node gt-hub.js <ton-nom>      # ou : npm run hub -- <ton-nom>   → ouvre ton navigateur
```

```
┌ Rooms ─────────┐┌ #notre-projet · chat ─────────┐┌ Présence ──────┐
│> #notre-projet ││ 14:02 mateo: go ?             ││ ● malou        │
│  #site-mateo   ││ 14:02 malou: oui              ││ ● mateo        │
│  #perso        ││                               ││ ● claude-m  ai │
│                ││ say… (@nom pour cibler) [Envoyer]│└────────────────┘
│ ＋Terminal ici ││                               ││ écran de mateo │
│ ＋Nouvelle room│└───────────────────────────────┘│ $ npm test ... │
└────────────────┘ Mes terminaux : #notre-projet ✕  └────────────────┘
```

- **Toutes les rooms** ouvertes et qui est dedans, en temps réel (● vert = actif, ● gris = idle).
- **Chat** de la room sélectionnée + envoi (`@nom` pour cibler) — sans rien re-scroller.
- **Voir l'écran d'un membre** en direct : clique son nom → peek live dans le panneau.
- **Ouvrir un terminal sur TON PC** dans une room (existante ou nouvelle) d'un clic.
- **Fermer un de tes terminaux** depuis la liste « Mes terminaux ».

> **Comment ça marche** : le hub est un petit programme qui tourne sur **ton** PC (une page web seule ne peut pas ouvrir de terminal sur ta machine). Il sert la page sur `http://localhost:4243`, se connecte au serveur pour l'état partagé, et lance/ferme les terminaux localement. Le **lanceur Windows démarre le hub tout seul** (un par PC). `-nodash` pour s'en passer.

### Alternative terminal (sans navigateur)

Si tu préfères un panneau dans un terminal à côté plutôt qu'une page web :

```bash
node gt-dash.js <ton-nom> <room>      # ou : npm run dash
```
Roster + chat live + ligne `say>`, pour une seule room. Ctrl+C restaure ton terminal intact.

---

## Architecture

Une machine fait tourner un **serveur relais** ; tout le monde s'y connecte.

```
   PC qui héberge                          PC du binôme
 ┌──────────────────────────┐           ┌────────────────────┐
 │  serveur (port 4242)      │   réseau  │  GroupTerm         │
 │  + ton GroupTerm          │◄─────────►│  (pointe vers      │
 │  (serveur = ce PC)        │  WebSocket│   l'adresse hôte)  │
 └──────────────────────────┘           └────────────────────┘
```

- **`server.js`** — relais WebSocket. Garde un **émulateur de terminal (`@xterm/headless`) par membre**, alimenté par son flux : `peek` renvoie l'**écran rendu** (propre), pas le flux brut. Garde aussi le transcript du `chat` par room.
- **`gt.js`** — le client : lance ton shell en passthrough transparent, diffuse sa sortie au serveur, injecte `peek`/`say`/`chat`/`who` dans le `PATH`, et injecte les `say` entrants via *bracketed paste* (`\x1b[200~…\x1b[201~`) pour réveiller l'IA cible.
- **`gt-hub.js`** + **`public/`** — le **hub web** (un par PC) : sert la page de contrôle sur `localhost:4243`, s'abonne à toutes les rooms du serveur, et ouvre/ferme les terminaux localement.
- **`gt-dash.js`** — variante TUI du tableau de bord (roster + chat) pour une room, dans un terminal à côté.
- **`gt-tool.js`** — implémentation one-shot derrière les commandes.
- **`gt-launch.ps1`** — lanceur (retient **plusieurs connexions**, menu de choix, démarre le serveur si besoin, ouvre le hub web).

---

## Prérequis

- **Node.js 18+** ([nodejs.org](https://nodejs.org), LTS)
- Windows (le lanceur et le clic droit sont en PowerShell ; le cœur Node est multiplateforme)

## Installation

```powershell
git clone https://github.com/dnkrow/GroupTerm.git
cd GroupTerm
powershell -ExecutionPolicy Bypass -File install.ps1
```

`install.ps1` fait le `npm install`, crée le **raccourci Bureau `GroupTerm`** et ajoute le **clic droit « Ouvrir GroupTerm ici »** (dossier + fond de dossier). Aucun droit administrateur requis.

---

## Mettre à jour GroupTerm (récupérer une nouvelle version)

Quand l'hôte a poussé une mise à jour sur GitHub, chaque binôme la récupère ainsi :

```powershell
cd <dossier GroupTerm>        # ex: le dossier où tu as cloné le repo
git pull
```

Puis **double-clic sur `GroupTerm`** (Bureau) : le lanceur à jour démarre le **hub web** et **ouvre ton navigateur** sur le tableau de bord. C'est tout.

Détails utiles :

- **Pas besoin de relancer `npm install`** sauf si les dépendances de `package.json` ont changé (la v1.1 n'en ajoute aucune : le hub n'utilise que des modules intégrés de Node + `ws`, déjà présent).
- **Tu peux faire `git pull` avec un GroupTerm déjà ouvert** : ça ne modifie que les fichiers sur le disque, ton terminal en cours continue de tourner et reste compatible avec le serveur.
- **Seul point d'attention** : si tu relances une fenêtre avec **le même nom + la même room** qu'un terminal déjà ouvert, le relais refuse le doublon et cette nouvelle fenêtre se ferme — **le dashboard s'ouvre quand même**. Le plus simple : ferme l'ancienne fenêtre avant de relancer, ou choisis une autre room.
- Pour récupérer le nouveau raccourci **« GroupTerm - Arrêter »** (et la mise à jour du désinstalleur), relance **`install.ps1`** une fois. Pas nécessaire pour le reste.

### ⚠️ Côté hôte uniquement (le PC qui fait tourner le serveur)

Le relais est un process **longue durée** : il faut le **redémarrer** pour qu'il charge le nouveau code, sinon les dashboards des binômes resteront vides (ils parlent à l'ancien serveur). Le plus simple, sur le PC hôte :

```powershell
# arrête tout GroupTerm de CE PC (terminaux + hub + relais), avec confirmation
powershell -ExecutionPolicy Bypass -File gt-launch.ps1 -stopall
# puis relance GroupTerm (double-clic) : un relais + un hub frais démarrent
```

Les binômes connectés se reconnectent **automatiquement** au nouveau relais en quelques secondes.

### Pour ton IA (Claude & co)

L'interface, c'est des **commandes shell** dispo dans le terminal GroupTerm, pour toi **comme pour ton IA** : `peek` (voir l'écran de l'autre), `say "..."` (lui parler), `chat` (relire), **`who`** (qui est connecté, nouveau en v1.1). Voir le tableau en haut de ce README. Les `say` reçus sont injectés préfixés `#` : si aucune IA ne tourne, c'est un commentaire inoffensif au prompt ; dans Claude Code, le message est lu normalement.

---

## Démarrage rapide

### Sur le PC qui héberge

1. Double-clic sur **GroupTerm** (Bureau).
2. À la 1ʳᵉ utilisation : ton nom (ex: `alice`), la room (ex: `notre-projet`), et le serveur → **laisse vide** (= ce PC). Le serveur démarre tout seul.

### Sur le PC du binôme

1. Installer GroupTerm (ci-dessus).
2. Double-clic sur **GroupTerm**.
3. Renseigner : son nom (ex: `bob`), la **même room** (`notre-projet`), et comme serveur **l'adresse du PC qui héberge** (voir Tailscale ci-dessous).

> Les réglages sont mémorisés dans `%USERPROFILE%\.groupterm.json`. Tu peux garder **plusieurs connexions** (projets/rooms) : le lanceur affiche alors un petit menu (Entrée = rouvrir la dernière). Pour en **ajouter une**, relance avec `-setup`. Pour ne pas ouvrir le tableau de bord : `-nodash`.

> **Arrêter proprement.** Fermer la croix d'un terminal ne ferme **que ce terminal** — le **relais** et le **hub** continuent de tourner en arrière-plan. Pour arrêter : raccourci Bureau **« GroupTerm - Arrêter »** (ou `gt-launch.ps1 -stop`) ferme tes terminaux + le hub en gardant le relais ; `gt-launch.ps1 -stopall` coupe **aussi** le relais (⚠️ déconnecte ton binôme).

---

## Se relier à distance avec Tailscale (recommandé)

[Tailscale](https://tailscale.com) crée un réseau privé chiffré entre vos machines, **sans toucher à la box ni au pare-feu**.

1. Les deux installent **Tailscale** (gratuit) et se connectent (même compte, ou partage de machine).
2. Chacun obtient une IP privée stable du type `100.x.x.x` (commande `tailscale ip -4`).
3. Le binôme met comme **serveur** l'**IP Tailscale du PC hôte**, ex. `100.101.102.103` (le lanceur ajoute `ws://` et `:4242` automatiquement).

C'est chiffré de bout en bout et **aucune règle de pare-feu n'est nécessaire** : le trafic arrive par l'interface Tailscale, qui autorise déjà les connexions entrantes.

### Variante : même réseau local (LAN)

Si vous êtes sur la même box, le binôme peut mettre directement l'IP locale de l'hôte (ex. `192.168.1.20`). Dans ce cas il faut **autoriser le port 4242** en entrée sur l'hôte (PowerShell admin) :

```powershell
New-NetFirewallRule -DisplayName "GroupTerm 4242" -Direction Inbound -Protocol TCP -LocalPort 4242 -Action Allow
```

> ⚠️ **Sécurité** : la liaison est en clair (`ws://`) et sans authentification. À utiliser **uniquement** via Tailscale (chiffré) ou sur un réseau de confiance. Ne pas exposer le port directement sur Internet.

---

## Variables d'environnement

| Variable | Défaut | Rôle |
|----------|--------|------|
| `GT_SERVER` | `ws://localhost:4242` | URL du serveur |
| `GT_ROOM` | `default` | Room (espace isolé) |
| `GT_NAME` | argument | Ton nom |
| `GT_ROLE` | `human` | `human` ou `ai` |
| `PORT` | `4242` | Port du serveur |

Lancement manuel (sans le lanceur) :

```bash
node server.js                                   # l'hôte
GT_SERVER=ws://100.x.x.x:4242 node gt.js bob notre-projet   # le binôme
```

## Superviser à distance

Comme chaque terminal est diffusé au serveur, on peut jeter un œil sans déranger :

```bash
GT_SERVER=ws://localhost:4242 GT_ROOM=notre-projet GT_NAME=superviseur node gt-tool.js peek alice
GT_SERVER=ws://localhost:4242 GT_ROOM=notre-projet GT_NAME=superviseur node gt-tool.js chat
```

## Tests

```bash
npm test             # flux say/peek/chat (livraison, transcript, cibles)
npm run test:wrapper # le wrapper diffuse bien + reçoit les say injectés
npm run test:dash    # le tableau de bord : présence (roster), chat live, et who
npm run test:hub     # le hub : abonnement global, liste des rooms, et fermeture (quit)
```

## Désinstaller

```powershell
powershell -ExecutionPolicy Bypass -File uninstall.ps1
```

Retire le raccourci et le clic droit (ne supprime pas le dossier).

---

## Limitations / pistes

- Pas de chiffrement ni d'auth au niveau applicatif → passer par Tailscale ou un LAN de confiance. Piste : token + `wss://`.
- La ligne de saisie en cours de composition d'un TUI peut rester volatile dans `peek` (négligeable).
- Pas de verrou de tour de parole strict (les `say` simultanés sont possibles). Piste : alternance optionnelle.

## Licence

MIT — voir [LICENSE](LICENSE).
