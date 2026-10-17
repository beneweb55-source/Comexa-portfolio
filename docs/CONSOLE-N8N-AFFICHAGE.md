# Contrat d’affichage — workflow « Moteur agent »

Le frontend accepte toujours `reply`, `output`, `message` ou `text` et les anciennes
propositions (`proposedAction` ou `action`, avec `id` ou `actionId`). Aucun changement
au proxy ni envoi de `metadata.pageContext` dans cette modification.

## Sources

Émettre du Markdown dans `reply`, pas du HTML :

```text
D'après [Projet Refonte](https://comexa-portfolio.vercel.app/espace-equipe/projets/IDENTIFIANT), …
```

Sections avec page détail : `projets`, `clients`, `devis`, `factures`.
**Attention : les tâches n’ont pas de route `/taches/<id>`** ; utiliser
`https://comexa-portfolio.vercel.app/espace-equipe/taches?tache=IDENTIFIANT`.
La console corrige aussi le format `/taches/<id>` vers cette route existante.
Encoder les identifiants dans les URL. Pour les types inconnus, citer type et id
sans inventer de lien. Les sources s’ouvrent dans un nouvel onglet ; les liens
internes utilisent l’origine du dashboard actuellement ouvert.

## Proposition d’action enrichie

Réponse JSON du webhook (l’objet est le transport, pas un dump dans `reply`) :

```json
{
  "reply": "Je propose de terminer la tâche Audit. Aucune modification n’est encore exécutée.",
  "proposedAction": {
    "actionId": "IDENTIFIANT_OPERATION_REEL",
    "summary": "Terminer la tâche Audit",
    "entity": { "type": "tache", "id": "IDENTIFIANT_TACHE", "name": "Audit" },
    "consequences": "La tâche Audit passera de TODO à DONE."
  }
}
```

`summary`, `entity.name` et `consequences` sont des chaînes de caractères.
La carte affiche ces trois informations si elles sont fournies, sans les inventer.
`label` et `description` restent des replis pour les anciennes réponses.
Le bouton de confirmation envoie toujours `/confirmer <actionId>` ; aucun changement
du protocole d’exécution. Le workflow doit continuer à vérifier la confirmation,
les permissions et l’état de l’opération côté serveur.

## Résumés et contexte

Le workflow, et non le rendu, doit limiter les lectures de plus de 8 éléments à
5 lignes de résumé au maximum, puis « la liste complète est disponible sur demande ».
Ne jamais mettre de dump JSON dans `reply`. Nommer les entités dans les suggestions.
Le rendu ne tronque pas arbitrairement les réponses : il ne connaît ni les résultats
complets des outils ni leur nombre. Les règles de résolution du contexte de page
restent côté workflow ; son transport devra faire l’objet d’une modification distincte.
