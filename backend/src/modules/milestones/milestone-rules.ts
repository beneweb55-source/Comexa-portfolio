import { SCOPE_ANY, type ScopeName } from '../../common/auth/principal.js';
import { MilestoneStatus } from '../../generated/prisma/enums.js';

/**
 * REGLES DES JALONS — fonctions PURES.
 *
 * Un jalon n'a pas de perimetre propre : il appartient a un projet, et c'est le
 * perimetre du PROJET qui decide qui le voit. `milestone:read:any` est d'ailleurs
 * detenu par le role CLIENT — « any » veut dire « tous les jalons des projets que
 * j'ai le droit de regarder », jamais « tous les jalons de l'agence ». Le filtre
 * est donc applique en amont, sur le projet, et ce fichier ne s'en occupe pas.
 */

/**
 * IL N'EXISTE QU'UN SEUL SCOPE POUR LES JALONS, ET C'EST `any`.
 *
 * Le catalogue ne declare ni `milestone:read:own` ni `milestone:write:own`, et ce
 * n'est pas un oubli : un jalon est une etape de projet, partagee par toute
 * l'equipe. L'ecrire sous forme de constante plutot qu'en litteral dans le
 * controleur rend ce fait verifiable par un test, et empeche qu'on ajoute un jour
 * un scope « own » sans se demander ce qu'il signifierait.
 */
export const MILESTONE_READ_ORDER: readonly ScopeName[] = [SCOPE_ANY];
export const MILESTONE_WRITE_ORDER: readonly ScopeName[] = [SCOPE_ANY];

/**
 * TRANSITIONS DE STATUT D'UN JALON.
 *
 * `REACHED` et `MISSED` ne sont pas des etapes de travail mais des CONSTATS. Le
 * schema porte `reachedAt` pour cette raison : atteindre un jalon date un fait,
 * et c'est ce fait que le client voit dans son espace.
 *
 * On autorise le retour depuis `REACHED` vers `IN_PROGRESS`, mais pas vers
 * `PENDING` : un jalon declare atteint puis desavoue doit laisser une trace de
 * son passage en `IN_PROGRESS`, sinon la correction efface toute memoire de
 * l'annonce faite au client.
 */
export const MILESTONE_STATUS_TRANSITIONS: Readonly<
  Record<MilestoneStatus, readonly MilestoneStatus[]>
> = {
  [MilestoneStatus.PENDING]: [
    MilestoneStatus.IN_PROGRESS,
    MilestoneStatus.REACHED,
    MilestoneStatus.MISSED,
    MilestoneStatus.CANCELLED,
  ],
  [MilestoneStatus.IN_PROGRESS]: [
    MilestoneStatus.REACHED,
    MilestoneStatus.MISSED,
    MilestoneStatus.CANCELLED,
    MilestoneStatus.PENDING,
  ],
  [MilestoneStatus.REACHED]: [MilestoneStatus.IN_PROGRESS],
  [MilestoneStatus.MISSED]: [
    MilestoneStatus.IN_PROGRESS,
    MilestoneStatus.REACHED,
    MilestoneStatus.CANCELLED,
  ],
  [MilestoneStatus.CANCELLED]: [MilestoneStatus.PENDING],
};

export function canTransitionMilestone(from: MilestoneStatus, to: MilestoneStatus): boolean {
  return MILESTONE_STATUS_TRANSITIONS[from].includes(to);
}

/**
 * Un jalon atteint est un FAIT date, pas un etat de travail.
 *
 * Le supprimer reviendrait a effacer une annonce faite au client, et a faire
 * disparaitre une ligne de l'historique du projet. On refuse donc la suppression
 * (`CANCELLED` est la sortie legitime), et cette regle est testee.
 */
export function isMilestoneDeletable(status: MilestoneStatus): boolean {
  return status !== MilestoneStatus.REACHED;
}
