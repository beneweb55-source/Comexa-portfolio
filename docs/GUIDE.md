# GUIDE DE DÉMARRAGE — premiers pas dans l’outil réel

> Ce document remplace les anciens `docs/FORMATION*.md`.
> Le mode formation (missions, niveaux, évaluations, bilan, base d’entraînement)
> **n’existe plus**. Il est remplacé par un guide court, fondé sur des gestes
> réels, vérifiés par le serveur.

---

## 1. L’idée en trois phrases

1. Un membre apprend l’outil en **faisant** trois à quatre gestes utiles, pas en
   lisant un cours.
2. Chaque étape avance **uniquement** quand le serveur constate l’effet dans les
   vraies données (une tâche créée, un temps saisi, un prospect enregistré).
3. Le guide ne bloque rien : il se ferme, se rouvre, se revoit, et ne note
   personne.

Ce que le guide n’est pas : un didacticiel, une simulation, un bac à sable, un
parcours noté. Aucun libellé « formation », « module », « niveau » ou « bilan »
n’apparaît à l’écran.

---

## 2. Où l’on voit le guide

| Élément | Fichier | Rôle |
| --- | --- | --- |
| Pastille flottante + fiche d’une étape | `src/components/guide/GuideDock.jsx` | « Premier pas 3 sur 5 », consigne, raison, bouton *Aller à l’écran* et *C’est fait* |
| Page courte | `src/components/guide/GuideView.jsx` | La liste complète, cochée par le serveur, groupe par espace |
| État partagé | `src/lib/guide/guide-context.jsx` | Charge `/guide`, rafraîchit au changement d’écran et au retour d’onglet |
| Fonctions pures | `src/lib/guide/guide-format.mjs` | Prochaine étape, rang, libellé de progression, sélecteur à montrer |
| Routes | `src/app/(session)/espace-*/guide/page.jsx` | `/espace-personnel/guide`, `/espace-equipe/guide`, `/espace-comexa/guide`, `/espace-client/guide` |
| Entrée de menu | `src/lib/space-navigation.js` | « Guide de démarrage » (section `guide`) |

La pastille se place en bas à droite, au-dessus du dock. « Plus tard » la réduit
à une puce discrète (`Guide · 2/5`) ; l’entrée de menu reste, elle, toujours
disponible.

### Le lien « Aller à l’écran »

Le bouton pousse `href + ?guide=<étape>`. `GuideDock` lit ce paramètre, fait
défiler le contrôle visé (`data-coach-id`) jusqu’au centre et l’entoure 6 s
(`data-guide-spot`), puis **retire le paramètre de l’URL** : rien ne colle au
rechargement ni à un lien partagé. Si l’on est déjà sur le bon écran, aucun
`router.push` n’a lieu — on ne recharge pas un formulaire en cours de saisie.

---

## 3. Le catalogue des étapes

Source unique : `backend/src/modules/guide/guide.catalog.ts`.
Identifiant : `<espace>:<slug>`, compatible avec la contrainte de
`onboarding_progress.completedChapterIds` (`^[a-z0-9][a-z0-9:._-]{0,119}$`).

| Espace | Étape | Nature | Preuve serveur |
| --- | --- | --- | --- |
| Personnel | `personal:premiere-tache` — créer une tâche personnelle | action | `task` où `assigneeId = moi` et `isPersonal = true` |
| Personnel | `personal:faire-avancer` — passer une tâche en « En cours » | action | `task` de `assigneeId = moi`, statut `IN_PROGRESS` |
| Personnel | `personal:chronometrer` — lancer puis arrêter le minuteur | action | `timeEntry` de `userId = moi` |
| Personnel | `personal:lire-temps` — relire « Mon temps » | visite + question | question corrigée côté serveur |
| Équipe | `team:prospect` — enregistrer un prospect | action | `prospect` de `ownerId = moi` |
| Équipe | `team:devis` — lire un devis | visite + question | question corrigée côté serveur |
| Équipe | `team:projet` — suivre un projet | visite | accusé de lecture (mémoire locale serveur) |
| Comexa | `comexa:contenu` — relire une offre publiée | visite + question | question corrigée côté serveur |
| Comexa | `comexa:membres` — comprendre les rôles | visite | accusé de lecture |
| Client | `client:devis` — consulter ses devis | visite + question | question corrigée côté serveur |
| Client | `client:demandes` — suivre ses demandes | visite | accusé de lecture |

Règles de rédaction (vérifiées par les tests) :

- un titre à l’impératif, une consigne **d’une phrase**, une raison **d’une
  phrase** (moins de 160 caractères chacune) ;
- aucun écran inventé : `href` commence toujours par `/espace-` ;
- une étape d’**action** porte toujours une preuve bornée au membre
  (`{{userId}}` obligatoire dans le filtre) ;
- une **question** propose au moins deux options, dont sa bonne réponse.

### Visibilité

`guide.rules.ts` filtre deux fois :

1. **par espace** : `accessibleSpaces()` (mêmes règles que le sélecteur
   d’espaces), plus l’espace client pour un inscrit sans rôle interne ;
2. **par droit** : chaque étape déclare `anyPermissions`, évaluées avec les
   droits **effectifs** de l’espace (`effectivePermissions`). Une étape qu’on ne
   peut pas exécuter n’est jamais renvoyée.

---

## 4. Contrat HTTP

| Route | Réponse |
| --- | --- |
| `GET /api/guide` | `{ spaces: [{ id, label, done, total, steps }], done, total, nextStepId }` |
| `POST /api/guide/steps/:stepId/complete` | `{ ok, stepId, overview }`, plus `explanation` (visite réussie) ou `correction` (mauvaise réponse) |

Une **étape** transmise au navigateur contient : `id`, `space`, `kind`,
`title`, `prompt`, `why`, `href`, `target?`, `done`, `recall?`
(`{ question, options }`). Le champ `proof` et la bonne réponse (`answerId`) ne
sortent **jamais** du serveur — un test le vérifie.

Codes d’erreur :

| Code | Statut | Quand |
| --- | --- | --- |
| `GUIDE_ACTION_ATTENDUE` | 409 | Le geste n’est pas (encore) constaté : la fiche reste ouverte avec la consigne |
| `GUIDE_REPONSE_REQUISE` | 400 | Étape à question validée sans choix |
| `GUIDE_STEP_NOT_FOUND` | 404 | Étape inconnue **ou** non visible avec ces droits |

Une mauvaise réponse ne valide rien : la réponse contient `ok: false` et la
correction (`optionId` + explication), l’étape reste à faire.

---

## 5. Où vit la progression

Aucune nouvelle table : la progression « vue » réutilise `onboarding_progress`
(`(userId, area)`, `completedChapterIds`). Elle est écrite par
`GuideService.acknowledge()` en `push` atomique, avec `revision += 1`.

Les étapes d’**action** ne dépendent pas de cette mémoire : elles sont
recalculées à chaque lecture (`count` Prisma). Si le membre supprime la tâche
qu’il avait créée, l’étape se décoche — c’est voulu : le guide montre l’état
réel, pas un historique de clics.

Aucun accès à une base d’entraînement, aucun jeton dédié, aucun envoi de
courriel simulé : tout passe par `PrismaService.prodClient`, qui n’est plus
qu’un alias documenté de la base de production.

---

## 6. Ce qui a été supprimé (et pourquoi)

| Supprimé | Remplacement |
| --- | --- |
| `/formation` (4 pages), `ParcoursView`, `CoachLayer`, `TrainingBanner`, `TrainingChrome` | `/guide` (4 pages), `GuideDock`, `GuideView` |
| Contexte `training-context` (session, jeton, bannière) | `guide-context` (aucune session) |
| `POST /training/enter|exit|reset`, catalogue de missions, évaluations, bilan | `GET /guide`, `POST /guide/steps/:id/complete` |
| Base `TRAINING_DATABASE_URL`, routeur Prisma bi-base, jeton `typ: training` | Une seule base ; migration `20261021120000_drop_training` |
| Libellés « formation », « Mon parcours », « niveau », « bilan » | « Guide de démarrage », « Premiers pas » |

La progression pédagogique stockée dans `training_*` est supprimée par la
migration (données d’exercice uniquement). `onboarding_progress` est conservée :
c’est elle qui porte la mémoire du guide.

---

## 7. Tests

| Commande | Ce qui est couvert |
| --- | --- |
| `npm run test:guide` | `backend/tests/guide.spec.ts` + `guide.service.spec.ts` : identifiants, preuves bornées au membre, questions, non-fuite de la réponse, visibilité par droits, refus sans preuve (409), 404 hors espace |
| `npm run test:guide-ui` | `tests/guide-ui.test.mjs` : prochaine étape, rang (jamais `NaN`), libellé de progression, lien du guide, espace du chemin, sélecteur du contrôle |
| `node --test tests/contract.test.mjs` | Le contrat `GET /api/health` réclame désormais `guide` (et non plus `training`) |
| `npx eslint src` | Zéro erreur sur le frontend |
| `npx next build` | Les 4 pages `/guide` sont construites |

---

## 8. Ajouter une étape

1. Écrire l’entrée dans `guide.catalog.ts` : titre, consigne, raison, `href`,
   `target` (un `data-coach-id` **existant**), `anyPermissions`.
2. Pour une étape d’action : ajouter `proof` avec un modèle de `PROOF_MODELS`
   et `{{userId}}`. Sans preuve constatable, préférer une visite + question.
3. Pour une visite : ajouter `recall` avec 2–3 options crédibles et une
   correction d’une phrase.
4. Lancer `npm run test:guide` — les règles de rédaction et de scoping sont
   vérifiées, y compris l’absence de fuite de la bonne réponse.
