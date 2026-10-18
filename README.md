This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.js`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Espaces client et équipe

Le site public est complété par deux espaces, protégés par session :

- `/inscription` puis `/verify-email` : création de compte avec vérification de l'adresse ; la connexion reste bloquée tant que l'adresse n'est pas vérifiée.
- `/connexion` : connexion. Chaque utilisateur arrive dans l'espace correspondant à ses droits.
- `/espace-client` : commandes, paiements, demandes de projet, suivi des projets.
- `/espace-equipe` : commandes, demandes de projet, projets, clients, membres et droits.

Le front appelle l'API via `/api/*`, relayé par Next vers le backend. Configurez l'adresse du backend avec la variable `BACKEND_URL` (par défaut `http://localhost:3001`).

```bash
# Backend (port 3001)
cd backend && npm run start:dev

# Front (port 3000)
BACKEND_URL=http://localhost:3001 npm run dev
```

Les vérifications : `npm run lint` et `npm run build` à la racine, `npm test` et `npm run test:e2e` dans `backend/`.

La suite bout-en-bout attend la **vérification d'adresse activée** (c'est le
scénario qu'elle teste) : `EMAIL_VERIFICATION_REQUIRED=true npm run test:e2e`.
Sans cette variable, le fichier `orders` échoue sur ses deux scénarios
d'inscription — le serveur, lui, se comporte bien dans les deux cas.

## Répartition & soldes (espace équipe)

`/espace-equipe/repartition` répartit une recette entre les membres de l'équipe,
selon une règle validée. Trois onglets : **Règles** (répartition globale et
exceptions par projet, avec historique des versions), **Calculs** (base de
calcul, arrondis tracés, application), **Soldes** (avances, paiements,
corrections, solde par membre et par devise).

Ce que le module garantit :

- le calcul est **fait côté serveur**, en décimaux exacts, dans une transaction ;
- une règle changed **ne recalcule jamais** une répartition déjà appliquée : la
  nouvelle version ne s'applique qu'aux calculs futurs, et une régularisation
  doit être saisis explicitement ;
- une opération financière validée **ne se supprime jamais** : on passe par une
  contre-operation, tracée et attribuée à son auteur ;
- chaque membre ne voit **que ses propres** mouvements ; les soldes de l'équipe
  sont réservés aux rôles qui ont le droit de les consulter ;
- **aucune conversion de devise automatique** : une devise inconnue est
  refusée, une devise connue mais inactive reste recevable, et un taux doit
  être documenté et l'opération explicite.

## Mode concentration

Depuis le dock, un bloc de travail immerseif : durée (préréglages ou saisie),
tâche facultative, note, « ne pas déranger ». Le décompte vient du **minuteur
serveur** — c'est donc exactement le temps qui finit dans la feuille de temps,
et la session **survit à un rechargement**. Le temps de concentration n'est
facturable que par la saisie qu'en fait le serveur, avec la même règle qu'une
saisie manuelle (une tâche personnelle n'est jamais facturable) : le module
« Répartition & soldes », lui, ne lit jamais la feuille de temps.

## API et intégrations (n8n, agents IA)

L'API est aussi joignable par des serveurs externes, avec un **jeton
d'intégration** : un jeton nommé par intégration, aux droits limités, révocable à
tout moment. Les machines appellent `/api/v1/...` (alias de `/api/...`), jamais la
session d'un utilisateur connecté.

Procédure complète, recettes n8n, permissions minimales et dépannage :
**[`docs/API-N8N.md`](docs/API-N8N.md)**.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
