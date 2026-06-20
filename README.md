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
| `say "message"` | Écrit le message **dans le terminal de l'autre** — il y apparaît comme une saisie, ce qui réveille son IA |
| `say --to bob "..."` | Cible une personne précise |
| `chat` | Affiche l'historique propre de la conversation |

Comme ce sont de **vraies commandes shell**, elles marchent pour toi comme pour une IA tournant dans le terminal : ton IA peut faire `peek` / `say` / `chat` d'elle-même.

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
- **`gt.js`** — le client : lance ton shell en passthrough transparent, diffuse sa sortie au serveur, injecte `peek`/`say`/`chat` dans le `PATH`, et injecte les `say` entrants via *bracketed paste* (`\x1b[200~…\x1b[201~`) pour réveiller l'IA cible.
- **`gt-tool.js`** — implémentation one-shot derrière les commandes.
- **`gt-launch.ps1`** — lanceur (retient nom/room/serveur, démarre le serveur si besoin).

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

## Démarrage rapide

### Sur le PC qui héberge

1. Double-clic sur **GroupTerm** (Bureau).
2. À la 1ʳᵉ utilisation : ton nom (ex: `alice`), la room (ex: `notre-projet`), et le serveur → **laisse vide** (= ce PC). Le serveur démarre tout seul.

### Sur le PC du binôme

1. Installer GroupTerm (ci-dessus).
2. Double-clic sur **GroupTerm**.
3. Renseigner : son nom (ex: `bob`), la **même room** (`notre-projet`), et comme serveur **l'adresse du PC qui héberge** (voir Tailscale ci-dessous).

> Les réglages sont mémorisés dans `%USERPROFILE%\.groupterm.json`. Pour les changer : relancer avec `-setup`, ou supprimer ce fichier.

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
