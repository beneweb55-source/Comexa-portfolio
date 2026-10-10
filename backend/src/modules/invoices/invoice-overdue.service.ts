import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuditService } from '../../common/audit/audit.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { ActivityType, InvoiceStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ActivityService } from '../activity/activity.service.js';
import { NotificationService } from '../notifications/notification.service.js';
import { clientPortalUserIds } from './audience.js';
import {
  isOverdueCandidate,
  overdueActivityMessage,
  overdueCandidatesWhere,
  overdueNotification,
} from './invoice-overdue.js';

/**
 * LE BALAYAGE DES ECHEANCES — le seul endroit du backend qui ecrit `OVERDUE`.
 *
 * POURQUOI UNE TACHE PLANIFIEE, ET RIEN D'AUTRE. Le retard n'est pas declenche
 * par un geste : personne ne clique « constater le retard ». Il est produit par
 * le temps qui passe, donc par une horloge. Aucune route ne l'expose — une route
 * devrait verifier une permission qui n'existe pas (« qui a le droit de constater
 * un retard ? »), et surtout elle ne serait appelee que quand quelqu'un y pense,
 * c'est-a-dire jamais. Le retard d'une facture est precisement le cas ou
 * l'absence de geste est le probleme.
 *
 * SEPARATION ENTRE LA REGLE ET LE BALAYAGE. Ce fichier ne decide de RIEN : la
 * decision est dans `invoice-overdue.ts` (`isOverdueCandidate`), qui se teste sans
 * base, statut par statut. Ici il n'y a que l'ordre des operations — lire, juger,
 * reclamer, ecrire, notifier, tracer.
 *
 * LA METHODE PUBLIQUE EST `sweepOverdue`, PAS LE `@Cron`. Le test appelle
 * `sweepOverdue(new Date(...))` directement, avec une date qu'il choisit : il ne
 * depend d'aucune horloge et n'attend pas qu'une minute passe. Le `@Cron` n'est
 * qu'une enveloppe mince posee sur la meme methode, pour qu'il n'existe pas deux
 * chemins de code dont un seul serait teste.
 *
 * L'IDEMPOTENCE VIENT DU `where` DE L'`updateMany`, PAS D'UN DRAPEAU. Chaque
 * facture est reclamee par un `updateMany` dont le `where` porte encore
 * `status: SENT` — la ou la lecture vient de voir cette valeur. Le nombre de
 * lignes modifiees dit qui a gagne : `1` pour celui qui reclame, `0` pour tous
 * les autres. Trois consequences, et c'est ce qui rend la tache sure :
 *
 *  1. deux executions consecutives : la seconde ne voit plus de `SENT` en
 *     retard (la premiere les a passes a `OVERDUE`), donc elle ne modifie rien
 *     et ne notifie personne. Aucun compteur a remettre a zero, aucun `already
 *     swept` a stocker ;
 *  2. deux instances du backend en parallele (un redeploiement, deux conteneurs
 *     pendant une minute) : la base arbitre. Une seule ecrit, l'autre voit `0`
 *     et ne notifie pas. Sans ce `where`, les deux auraient notifie le client —
 *     et une relance en double est exactement ce qui ne doit pas arriver ;
 *  3. un encaissement ou une annulation survenu PENDANT le balayage : le statut
 *     n'est plus `SENT`, la reclamation echoue et la facture est laissee telle
 *     quelle. La reclamation rejoue d'ailleurs TOUT le predicat de lecture
 *     (`overdueCandidatesWhere`), pas seulement le statut, pour que la lecture et
 *     l'ecriture ne puissent pas juger deux etats differents.
 *
 * UNE TRANSACTION PAR FACTURE, PAS UNE POUR TOUT LE LOT. Un balayage qui
 * echouerait sur la dixieme facture d'un lot de mille ne doit pas annuler les
 * neuf premieres : chaque facture est un fait independant, avec son activite et
 * ses notifications. L'echec d'une ligne est journalise et n'interrompt pas les
 * suivantes — l'horloge suivante rattrapera ce qui n'a pas ete fait.
 *
 * CE QUI EST ECRIT DANS LA TRANSACTION, ET CE QUI EN SORT. L'activite du dossier
 * et les notifications partent DANS la transaction, comme a l'envoi d'une
 * facture : une notification qui annonce un retard doit disparaitre avec lui si
 * la transaction est annulee. Le journal d'audit, lui, est ecrit APRES le commit,
 * comme partout ailleurs — il trace un fait accompli.
 */
@Injectable()
export class InvoiceOverdueService {
  private readonly logger = new Logger(InvoiceOverdueService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Le balayage planifie.
   *
   * `EVERY_HOUR` : le retard doit apparaitre le jour ou l'echeance passe, pas la
   * veille du rapport mensuel. Une heure est un compromis lisible — la tache est
   * sans cout (un `SELECT` indexe sur `status`), et un client qui regarde sa
   * piece le matin la voit deja « en retard » si elle l'est.
   *
   * `waitForCompletion` : si un balayage depassait l'heure (premier demarrage
   * avec un arriere considerable), la tache suivante est SAUTEE au lieu de
   * s'executer en parallele. Ce n'est pas une protection necessaire — le
   * `updateMany` rend deux balayages concurrents inoffensifs — mais deux
   * balayages simultanes qui lisent le meme arriere feraient deux fois le travail
   * pour le meme resultat.
   *
   * L'ERREUR NE S'ECHAPPE PAS : une exception qui remonte d'un `@Cron` ne
   * remonte a personne (il n'y a pas d'appelant HTTP), elle est avalee par le
   * planificateur ou, au mieux, journalisee dans un contexte qui ne dit pas
   * quelle facture a echoue. On journalise ici, avec le detail, et la prochaine
   * heure reprend.
   */
  @Cron(CronExpression.EVERY_HOUR, {
    name: 'invoice-overdue-sweep',
    waitForCompletion: true,
  })
  async runOverdueSweep(): Promise<void> {
    try {
      const result = await this.sweepOverdue();

      if (result.markedOverdue > 0) {
        this.logger.log(
          `Echeances depassees : ${result.markedOverdue} facture(s) passee(s) en retard ` +
            `sur ${result.examined} examinee(s), ${result.notified} notification(s) deposee(s).`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Balayage des echeances interrompu : ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Le balayage lui-meme, avec la date que l'appelant choisit.
   *
   * `now` est un PARAMETRE, pas un `new Date()` cache dans le corps : c'est ce
   * qui rend le test possible sans horloge factice ni attente. La production
   * l'omet et prend l'instant courant — la seule difference entre les deux
   * appelants est cette date.
   *
   * Le compte rendu (`examined`, `markedOverdue`, `notified`) sert aux journaux
   * et aux assertions du test. Il est renvoye plutot que journalise ici : une
   * methode qui decide de son propre niveau de journalisation ne se teste qu'en
   * lisant des logs.
   */
  async sweepOverdue(now: Date = new Date()): Promise<OverdueSweepResult> {
    const candidates = await this.prisma.invoice.findMany({
      where: overdueCandidatesWhere(now),
      select: OVERDUE_CANDIDATE_SELECT,
    });

    let markedOverdue = 0;
    let notified = 0;

    for (const invoice of candidates) {
      // La lecture SQL est un pre-filtre : la decision se prend ici, ou la regle
      // est ecrite en clair et testee statut par statut.
      if (!isOverdueCandidate(invoice, now)) {
        continue;
      }

      try {
        const outcome = await this.prisma.$transaction(async (tx) => {
          const claimed = await tx.invoice.updateMany({
            where: { ...overdueCandidatesWhere(now), id: invoice.id },
            data: { status: InvoiceStatus.OVERDUE },
          });

          // Perdu la course : quelqu'un d'autre a deja marque cette facture, ou
          // son etat a bouge. Ce n'est pas une erreur — surtout, on ne notifie
          // pas : le client a deja recu l'information (ou n'a pas a la recevoir).
          if (claimed.count === 0) {
            return { marked: false, notified: 0 };
          }

          await this.activity.record(
            {
              type: ActivityType.STATUS_CHANGE,
              message: overdueActivityMessage(invoice),
              clientId: invoice.clientId,
              // `null` : personne n'a decide, c'est l'echeance qui est passee. Un
              // `actorId` invente ferait porter a un compte une action qu'il n'a
              // pas faite.
              actorId: null,
              metadata: {
                reference: invoice.reference,
                status: InvoiceStatus.OVERDUE,
                previousStatus: InvoiceStatus.SENT,
                dueDate: invoice.dueDate.toISOString(),
                total: invoice.total.toFixed(2),
              },
              isClientVisible: true,
            },
            tx,
          );

          const recipients = await clientPortalUserIds(invoice.clientId, tx);

          for (const userId of recipients) {
            await this.notifications.notify(userId, overdueNotification(invoice), tx);
          }

          return { marked: true, notified: recipients.length };
        });

        if (outcome.marked) {
          markedOverdue += 1;
          notified += outcome.notified;

          await this.audit.record({
            actorId: null,
            action: 'INVOICE_MARKED_OVERDUE',
            entityType: 'Invoice',
            entityId: invoice.id,
            before: { status: InvoiceStatus.SENT },
            after: {
              reference: invoice.reference,
              status: InvoiceStatus.OVERDUE,
              clientId: invoice.clientId,
              currency: invoice.currency,
              total: invoice.total.toFixed(2),
              amountPaid: invoice.amountPaid.toFixed(2),
              dueDate: invoice.dueDate.toISOString(),
            },
          });
        }
      } catch (error) {
        // Une facture qui echoue ne doit pas empecher les suivantes : le lot
        // suivant ne la contient plus de toute facon (`status` toujours `SENT`),
        // donc elle sera retentee a l'heure suivante.
        this.logger.error(
          `Facture ${invoice.reference} : passage en retard impossible — ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return { examined: candidates.length, markedOverdue, notified };
  }
}

/** Le compte rendu d'un balayage. */
export interface OverdueSweepResult {
  /** Factures ramenees par le pre-filtre et jugees une par une. */
  readonly examined: number;
  /** Factures effectivement passees en `OVERDUE` par ce balayage. */
  readonly markedOverdue: number;
  /** Notifications deposees (une par porteur de l'espace client). */
  readonly notified: number;
}

/**
 * Les colonnes necessaires, et rien de plus.
 *
 * `amountPaid` est la pour la troisieme condition de la decision (le solde), et
 * `total` parce que la notification porte le montant REEL de la piece : il est lu
 * ici, jamais recalcule a partir des lignes, qui ne sont pas chargees. Un
 * balayage qui chargerait les lignes de chaque facture en retard ferait cent
 * requetes pour un montant que la colonne porte deja — et ce montant est celui
 * qui fait foi, c'est celui qu'affiche la facture.
 */
const OVERDUE_CANDIDATE_SELECT = {
  id: true,
  reference: true,
  clientId: true,
  currency: true,
  total: true,
  amountPaid: true,
  dueDate: true,
  // `status` est selectionne pour que la decision le VERIFIE a nouveau, ligne par
  // ligne, au lieu de faire confiance au `where` qui vient de le filtrer. La
  // compilation y gagne aussi : la ligne lue doit satisfaire `OverdueInvoice` au
  // moment ou elle est passee a `isOverdueCandidate` et a `overdueNotification`.
  // Une colonne retiree ici cesse donc de compiler, au lieu de valoir `undefined`
  // a l'execution.
  status: true,
} satisfies Prisma.InvoiceSelect;
