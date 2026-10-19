# syntax=docker/dockerfile:1

# =============================================================================
# API Comexa — image d'execution
# =============================================================================
# Quatre etapes, et le decoupage n'est pas cosmetique : chacune existe pour que
# la suivante n'ait pas a porter ce dont elle n'a pas besoin.
#
#   deps      : installe TOUTES les dependances, depuis le lockfile seul.
#   build     : genere le client Prisma, compile TypeScript.
#   prod-deps : reinstalle les seules dependances d'execution.
#   runtime   : ne recoit que `dist/`, `node_modules` de production, et le
#               strict necessaire pour lancer le serveur.
#
# TROIS PROPRIETES DE CE FICHIER MERITENT D'ETRE COMPRISES AVANT DE LE MODIFIER.
#
# 1. LE CLIENT PRISMA EST GENERE DANS L'IMAGE, PAS COPIE.
#    `src/generated/` est ignore par git : il est reproductible depuis le
#    schema. Prisma 7 emet du TYPESCRIPT, donc `nest build` le compile avec le
#    reste et `dist/` est autosuffisant au lancement. Copier un `src/generated/`
#    venu de la machine du developpeur ferait entrer un client desynchronise du
#    schema de l'image — le genre de decalage qui ne se voit qu'en production.
#
# 2. AUCUN SECRET N'ENTRE DANS UNE COUCHE D'IMAGE.
#    `prisma generate` n'a pas besoin de la base : `prisma.config.ts` retombe
#    sur une URL vide quand `DATABASE_URL` manque (voir le commentaire de ce
#    fichier). C'est delibere, et c'est ce qui permet de compiler sans jamais
#    exposer la chaine de connexion. Une chaine de connexion ecrite dans un
#    `ENV` ou un `ARG` reste lisible par quiconque recupere l'image, meme si la
#    couche est ensuite supprimee.
#
# 3. LE SERVEUR TOURNE EN UTILISATEUR NON-ROOT.
#    L'image officielle Node fournit deja l'utilisateur `node` (uid 1000). Un
#    processus d'API compromis qui tourne en root dans un conteneur a un chemin
#    direct vers l'hote par les montages et les sockets ; en non-root, il n'en a
#    pas.
# =============================================================================

ARG NODE_VERSION=24

# --- 1. Dependances completes -------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS deps

# Prisma doit detecter OpenSSL 3 AVANT l'installation des dependances et la
# generation, sinon il choisit par defaut un moteur OpenSSL 1.1 incompatible
# avec Debian Bookworm. `build` et `prod-deps` heritent de cette installation.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Le lockfile seul, AVANT le reste du code : tant que les dependances ne
# changent pas, cette couche est reutilisee et le build ne repart pas de zero a
# chaque correction de virgule dans `src/`.
COPY package.json package-lock.json ./

# `npm ci` et non `npm install` : le lockfile fait foi. Une dependance qui
# divergerait du lockfile doit faire ECHOUER le build, plutot que partir en
# production dans une version que personne n'a installee ni testee.
RUN npm ci

# --- 2. Compilation -----------------------------------------------------------
FROM deps AS build
WORKDIR /app

# La configuration de compilation et le schema, avant les sources : `prisma
# generate` ne depend que d'eux, et les sources changent a chaque commit.
COPY prisma.config.ts tsconfig.json tsconfig.build.json nest-cli.json ./
COPY prisma ./prisma

# Pas de `DATABASE_URL` ici, volontairement — voir la propriete 2 en tete.
RUN npx prisma generate

COPY src ./src
COPY assets ./assets
RUN npm run build

# --- 3. Dependances d'execution ----------------------------------------------
FROM deps AS prod-deps
WORKDIR /app
# Repart de `deps` pour heriter du cache npm, mais reinstalle proprement : c'est
# le seul moyen d'obtenir un arbre de production coherent sans supprimer a la
# main des dossiers dont on ne sait plus qui les utilise.
RUN npm ci --omit=dev

# --- 4. Execution -------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime

# `dumb-init` : Node en PID 1 ne transmet pas SIGTERM a ses enfants et ne
# recolte pas les processus zombies. Sans lui, `docker compose stop` attend le
# delai de grace puis tue le conteneur — `app.enableShutdownHooks()` ne ferme
# jamais proprement la connexion PostgreSQL, et des connexions restent ouvertes
# cote base a chaque redeploiement.
# OpenSSL est aussi necessaire ici : `prisma migrate deploy` s'execute dans
# cette etape, qui ne descend pas de `deps`.
RUN apt-get update \
    && apt-get install -y --no-install-recommends dumb-init openssl \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3001

WORKDIR /app

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build     --chown=node:node /app/dist         ./dist
COPY --from=build     --chown=node:node /app/assets      ./assets
COPY --from=build     --chown=node:node /app/prisma       ./prisma
COPY --from=build     --chown=node:node /app/prisma.config.ts ./prisma.config.ts
COPY --chown=node:node package.json ./

# Le dossier de stockage local n'existe que pour `STORAGE_DRIVER=local`, refuse
# en production (voir StorageModule). Il est cree ici pour que le mode
# developpement en conteneur fonctionne sans monter de volume, et appartient a
# `node` : un dossier appartenant a root ferait echouer le premier envoi de
# fichier avec une erreur de permission, apres le deploiement.
RUN mkdir -p /app/storage && chown -R node:node /app/storage

USER node

EXPOSE 3001

# `node -e` plutot que `curl` : l'image slim ne l'installe pas, et ajouter un
# client HTTP entier pour une sonde serait disproportionne. La sonde interroge
# la vraie route `/api/health`, qui verifie la base — un conteneur qui repond
# sans atteindre PostgreSQL n'est pas en bonne sante et ne doit pas etre declare
# tel.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Les MIGRATIONS tournent au demarrage, avant le serveur.
#
# `prisma migrate deploy` est idempotent : sans migration en attente, il ne fait
# rien et rend la main en moins d'une seconde. C'est la piece qui manquait a la
# chaine « push = mise en production » : sans elle, une image neuve demarrait
# sur un schema ancien et chaque nouvelle table tombait en erreur 500 jusqu'a
# une intervention manuelle. `exec` fait de Node le PID 1 effectif (via
# dumb-init) : SIGTERM le rejoint au lieu de rester dans un shell.
ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/main.js"]
