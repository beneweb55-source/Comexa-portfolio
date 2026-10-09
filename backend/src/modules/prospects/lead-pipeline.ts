import { AppException } from '../../common/errors/app-error.js';
import { LeadStatus } from '../../generated/prisma/enums.js';

/**
 * LA MACHINE A ETATS DU PIPELINE COMMERCIAL.
 *
 * Ce fichier ne contient que des regles, aucune requete. C'est deliberé : la
 * machine a etats doit rester vraie pour TOUS les appelants du module — le
 * controleur, la conversion, et demain l'acceptation d'un devis qui declenche la
 * conversion depuis un autre module. Une transition redecidee ailleurs
 * produirait un historique incapable de raconter le parcours reel, or
 * l'historique est la preuve de ce parcours.
 *
 * CE QUE « TRANSITION INTERDITE » VEUT DIRE ICI.
 *
 *  - On ne saute pas la qualification : un prospect passe de CONTACTED a
 *    PROPOSAL_SENT, jamais de NEW a WON.
 *  - La negociation est un aller-retour : PROPOSAL_SENT et NEGOTIATION
 *    communiquent dans les deux sens. Un devis revise se renvoie, et refuser
 *    ce mouvement obligerait le commercial a mentir sur l'etape reelle.
 *  - WON est TERMINAL. Un prospect gagne devient un client ; le faire
 *    redescendre dans le pipeline effacerait la raison d'etre du client cree.
 *  - LOST n'a qu'une sortie : NEW. Une piste perdue se REPREND, elle ne repart
 *    pas au milieu du parcours comme si les premiers echanges n'avaient pas eu
 *    lieu — une reprise est une nouvelle piste, avec son propre historique.
 *
 * Le type `Record<LeadStatus, ...>` rend la table EXHAUSTIVE : ajouter une
 * etape a l'enum sans declarer ses sorties ne compile pas.
 */
export const LEAD_TRANSITIONS: Record<LeadStatus, readonly LeadStatus[]> = {
  [LeadStatus.NEW]: [LeadStatus.CONTACTED, LeadStatus.QUALIFIED, LeadStatus.LOST],
  [LeadStatus.CONTACTED]: [
    LeadStatus.QUALIFIED,
    LeadStatus.PROPOSAL_SENT,
    LeadStatus.NEGOTIATION,
    LeadStatus.LOST,
  ],
  [LeadStatus.QUALIFIED]: [LeadStatus.PROPOSAL_SENT, LeadStatus.NEGOTIATION, LeadStatus.LOST],
  [LeadStatus.PROPOSAL_SENT]: [LeadStatus.NEGOTIATION, LeadStatus.WON, LeadStatus.LOST],
  [LeadStatus.NEGOTIATION]: [LeadStatus.PROPOSAL_SENT, LeadStatus.WON, LeadStatus.LOST],
  [LeadStatus.WON]: [],
  [LeadStatus.LOST]: [LeadStatus.NEW],
};

/** Les sorties autorisees depuis une etape. Jamais `undefined` : la table est exhaustive. */
export function transitionsFrom(status: LeadStatus): readonly LeadStatus[] {
  return LEAD_TRANSITIONS[status];
}

export function canTransition(from: LeadStatus, to: LeadStatus): boolean {
  return LEAD_TRANSITIONS[from].includes(to);
}

/**
 * Refuse une transition qui n'existe pas dans la table.
 *
 * Deux cas distincts, et le 422 porte le detail dans les deux : le frontend doit
 * pouvoir afficher la meme etape sans redeviner la table.
 *
 * `from === to` est refuse et non ignore. Ecrire une ligne d'historique
 * WON -> WON serait une ligne qui n'atteste d'aucun changement : exactement ce
 * que l'historique ne doit jamais contenir.
 */
export function assertTransitionAllowed(from: LeadStatus, to: LeadStatus): void {
  if (from === to) {
    throw AppException.unprocessable(
      'LEAD_STATUS_UNCHANGED',
      `Ce prospect est deja au statut ${to}.`,
      { from, to },
    );
  }

  if (!canTransition(from, to)) {
    throw AppException.unprocessable(
      'LEAD_STATUS_TRANSITION_INVALID',
      `Transition interdite : ${from} -> ${to}.`,
      { from, to, allowed: transitionsFrom(from) },
    );
  }
}

/**
 * Refuse une conversion qui n'a pas lieu d'etre.
 *
 * La conversion est idempotente PAR REFUS : rejouer l'appel sur un prospect deja
 * converti renvoie 409, il ne cree pas un second client. C'est un choix, et il
 * vaut mieux qu'une tolerance silencieuse — un appelant qui convertit deux fois
 * a un bogue, et le lui cacher laisserait deux dossiers clients pour une seule
 * affaire.
 *
 * LOST est refuse parce que convertir une piste perdue reviendrait a gagner un
 * marche qu'on a explicitement declare perdu : la fiche dirait LOST et l'espace
 * client existerait. Une piste se reprend (LOST -> NEW) avant de se convertir.
 */
export function assertConvertible(prospect: {
  status: LeadStatus;
  convertedClientId: string | null;
}): void {
  if (prospect.convertedClientId !== null) {
    throw AppException.conflict(
      'PROSPECT_ALREADY_CONVERTED',
      'Ce prospect a deja ete converti en client.',
    );
  }

  if (prospect.status === LeadStatus.LOST) {
    throw AppException.unprocessable(
      'PROSPECT_LOST_NOT_CONVERTIBLE',
      'Un prospect perdu ne peut pas etre converti. Reprenez la piste avant de la convertir.',
      { status: prospect.status },
    );
  }
}
