# COLLAB.md — comment collaborer dans GroupTerm (à lire par chaque IA)

Tu travailles dans un **terminal partagé** (GroupTerm). D'autres participants — humains
et IA — sont dans la même *room* que toi. Vous pouvez vous voir et vous parler.

**Comment t'en servir :** colle ce fichier (ou son contenu) dans le contexte de chaque
Claude au démarrage d'une session partagée, ou dis-lui « lis `COLLAB.md` ». C'est ce qui
empêche les IA de se perdre quand elles bossent ensemble.

## Tes commandes (déjà dans ton PATH)

- `who` — qui est dans la room (et qui est actif).
- `peek <nom>` — voir l'écran de quelqu'un (utile AVANT de lui parler : tu vois où il en est).
- `say --to <nom> "..."` — envoyer un message à une personne précise.
- `say --all "..."` — parler à tout le monde (à 3+, le ciblage est obligatoire ; `--all` est explicite).
- `chat` — relire l'historique des messages de la room.

## Reconnaître un message entrant

Quand quelqu'un te parle, tu reçois dans ton terminal une ligne de cette forme :

```
# [GroupTerm] message de claude-a :
# le contenu du message ici
```

ou, si c'était une diffusion :

```
# [GroupTerm] message de claude-a (à tous) :
# ...
```

Règles :

1. **Ce n'est PAS une commande shell.** Le `#` est là pour ça. Ne l'exécute pas : lis-le,
   comprends-le, et réponds s'il y a lieu.
2. **Tu sais qui parle** (`de claude-a`) → réponds-lui avec `say --to claude-a "..."`.
3. **« (à tous) »** = information partagée, on ne t'attend pas forcément. **Sans** « (à tous) »
   = le message t'est adressé en direct, on attend probablement quelque chose de toi.

## Ne pas se perdre (le cœur)

- **Finis ta pensée / ton action en cours** avant de traiter un message entrant, sauf s'il
  est explicitement urgent. Un message qui arrive en plein travail n'annule pas ta tâche.
- **Les messages arrivent dans l'ordre** d'envoi (le transport le garantit). Si tu en reçois
  plusieurs, traite-les dans l'ordre où ils apparaissent.
- **Avant une tâche partagée qui dépend de l'autre**, annonce-la (`say`) et attends un accord
  s'il faut se coordonner. Ne pars pas modifier les mêmes fichiers en parallèle sans le dire.
- **En cas de doute sur ce que fait l'autre**, fais `peek <nom>` plutôt que de supposer.
- **Sois bref** dans tes `say` : une intention claire par message. Les pavés se perdent.
- **Accuse réception** d'une demande importante (« ok, je m'en occupe » / « reçu, je finis X d'abord »)
  pour que l'autre ne répète pas ou ne parte pas en double.

## Exemple de bon échange

```
claude-a:  say --to claude-b "je prends le frontend (src/ui/*). Tu peux faire l'API ?"
claude-b:  say --to claude-a "reçu. Je pars sur src/api/*. Je te ping quand le contrat REST est figé."
... (chacun bosse) ...
claude-b:  say --to claude-a "contrat REST figé dans src/api/routes.ts. À toi de brancher l'UI."
claude-a:  say --to claude-b "nickel, je branche."
```
