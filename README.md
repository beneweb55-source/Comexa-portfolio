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

## API et intégrations (n8n, agents IA)

L'API est aussi joignable par des serveurs externes, avec un **jeton
d'intégration** : un jeton nommé par intégration, aux droits limités, révocable à
tout moment. Les machines appellent `/api/v1/...` (alias de `/api/...`), jamais la
session d'un utilisateur connecté.

Procédure complète, recettes n8n, permissions minimales et dépannage :
**[`docs/API-N8N.md`](docs/API-N8N.md)**.

Deux routes servent le bot Telegram : la **transcription des messages vocaux** et
l'**envoi de messages WhatsApp depuis un compte autorisé** (le sien, ou celui d'un
tiers qui y consent). Architecture, consentement, garde-fous et risques — dont
celui, réel, de suspension du numéro :
**[`docs/TELEGRAM-VOIX-WHATSAPP.md`](docs/TELEGRAM-VOIX-WHATSAPP.md)**.

Le workflow n8n qui les relie est fourni, importable et testé
(`integrations/n8n/comexa-bot-telegram.json`, `npm run test:n8n`) :
**[`docs/N8N-WORKFLOWS.md`](docs/N8N-WORKFLOWS.md)**.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
