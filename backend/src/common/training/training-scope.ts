/**
 * SCOPE DE FORMATION — la frontière serveur entre données réelles et données
 * fictives.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI CE FICHIER EXISTE
 * ---------------------------------------------------------------------------
 * L'environnement d'entraînement de COMEXA réutilise les contrôleurs, services,
 * validations et règles métier réels. C'est une exigence produit : un membre
 * qui apprend sur un formulaire doit retrouver le même formulaire au travail.
 * Mais « réutiliser les mêmes services » implique qu'UNE MÊME fonction métier
 * (créer un devis, enregistrer un paiement) doit écrire tantôt dans la base de
 * production, tantôt dans la base d'entraînement.
 *
 * La décision se prend ICI, et elle ne se prend jamais sur une information
 * fournie par le navigateur :
 *
 *  - le scope est un état de REQUÊTE, porté par `AsyncLocalStorage`, posé par
 *    un middleware Express en tête de chaîne puis MARQUÉ par le garde
 *    d'authentification quand — et seulement quand — le jeton présenté est un
 *    jeton de formation signé par le serveur (typ `training`, session active) ;
 *  - aucun en-tête, paramètre d'URL ou champ de corps ne peut activer le scope.
 *    Un appel direct à l'API avec un jeton de formation atteint donc la base
 *    d'entraînement ; avec un jeton ordinaire, il atteint la base de production
 *    comme n'importe quel appel de l'application — jamais l'inverse ;
 *  - les écritures de formation ne peuvent pas atteindre la production, même
 *    par erreur de programmation : le routeur Prisma (voir `prisma.service.ts`)
 *    envoie chaque modèle vers le BON client en fonction de ce scope, et les
 *    deux clients parlent à DEUX bases différentes (`DATABASE_URL` et
 *    `TRAINING_DATABASE_URL`).
 *
 * ---------------------------------------------------------------------------
 * PORTÉE DU MÉCANISME
 * ---------------------------------------------------------------------------
 * Tout ce qui s'exécute dans la continuation d'une requête HTTP marquée est
 * « en formation » : contrôleurs, services, transactions Prisma. Les tâches
 * planifiées (cron de relance des factures) et les passerelles WebSocket ne
 * passent jamais par ce scope — ils agissent donc toujours sur la production,
 * et c'est voulu : une facture fictive ne devient jamais « en retard » toute
 * seule, et aucune notification de formation ne pousse sur un vrai socket.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

export interface TrainingStore {
  /** Vrai dès que le garde a accepté un jeton de formation. */
  training: boolean;
  /** Identifiant de la session de formation (`TrainingSession.id`, base prod). */
  sessionId?: string;
  /** Porteur de la session (utilisateur réel, base prod). */
  userId?: string;
}

const storage = new AsyncLocalStorage<TrainingStore>();

/**
 * Middleware Express à enregistrer AVANT les routes (voir `app.setup.ts`).
 *
 * Il crée le magasin mutable de la requête. Le garde d'authentification y
 * posera plus tard `training = true` s'il reconnaît un jeton de formation ;
 * tout le reste de la continuation — y compris les services appelés par le
 * contrôleur — lit le même objet.
 */
export function trainingScopeMiddleware(_req: Request, _res: Response, next: NextFunction): void {
  storage.run({ training: false }, () => {
    next();
  });
}

/**
 * Meme ouverture de magasin que le middleware, hors Express — pour les tests
 * du garde et les scripts qui simulent une requete.
 */
export function runWithRequestTrainingStore<T>(fn: () => T): T {
  return storage.run({ training: false }, fn);
}

/**
 * Marque la requête courante comme exécutée en formation.
 *
 * Réservé au garde d'authentification, après vérification cryptographique du
 * jeton ET contrôle de la session côté serveur. Ne jamais appeler depuis un
 * contrôleur : le scope ne doit dépendre d'aucune donnée client.
 */
export function markTrainingScope(sessionId: string, userId: string): void {
  const store = storage.getStore();
  if (!store) {
    // Hors continuation HTTP (script, cron) : rien à marquer. Un appel qui
    // arriverait ici sans middleware ne doit pas créer un scope implicite.
    throw new Error(
      'markTrainingScope hors requête HTTP : le middleware de scope de formation est-il enregistré ?',
    );
  }
  store.training = true;
  store.sessionId = sessionId;
  store.userId = userId;
}

/** Vrai si la continuation courante est une opération de formation. */
export function isTrainingScope(): boolean {
  return storage.getStore()?.training === true;
}

/** Session de formation de la requête courante, ou `null`. */
export function currentTrainingSessionId(): string | null {
  return storage.getStore()?.sessionId ?? null;
}

/**
 * Exécute `fn` dans un scope de formation explicite.
 *
 * Usage interne uniquement : amorçage (jeu de données), réinitialisation et
 * vérification des missions — là où il n'y a pas de requête HTTP à marquer.
 * `runInTrainingScope(() => ...)` enveloppe des appels SYNCHRONES ou la
 * création de promesses ; le contexte suit toute la chaîne d'attente.
 */
export function runInTrainingScope<T>(fn: () => T, sessionId = 'bootstrap'): T {
  return storage.run({ training: true, sessionId }, fn);
}

/**
 * Exécute `fn` HORS de tout scope de formation.
 *
 * Certains chemins doivent rester réels même pendant une requête de formation :
 * écriture de la progression pédagogique, rotation de jetons, écriture du
 * journal d'audit pédagogique. La coupure est explicite pour que la lecture du
 * code dise « ça, c'est de la production ».
 */
export function runInProductionScope<T>(fn: () => T): T {
  return storage.run({ training: false }, fn);
}
