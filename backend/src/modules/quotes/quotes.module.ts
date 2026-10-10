import { Module } from '@nestjs/common';
import { MailModule } from '../../common/mail/mail.module.js';
import { ActivityModule } from '../activity/activity.module.js';
import { ClientsModule } from '../clients/clients.module.js';
import { CountersModule } from '../counters/counters.module.js';
import { NotificationModule } from '../notifications/notification.module.js';
import { QuotesController } from './quotes.controller.js';
import { QuotesService } from './quotes.service.js';

/**
 * Module des DEVIS.
 *
 * CINQ DEPENDANCES, ET AUCUNE DE PLUS.
 *
 *  - `ClientsModule` : un devis accepte par un prospect CONVERTIT ce prospect.
 *    La conversion elle-meme — creation du dossier, du contact principal, de sa
 *    reference — reste l'affaire du module clients ; ce module ne fait que
 *    l'appeler DANS sa propre transaction (`ClientsService.createFromProspect`,
 *    qui prend un `tx`). Reecrire ici la creation d'un client donnerait deux
 *    implementations de la meme regle, et deux dossiers pour un meme prospect.
 *  - `CountersModule` : la reference et le couple `(sequence, year)` des devis,
 *    puis celle du projet ne de l'acceptation.
 *  - `ActivityModule` et `NotificationModule` : le fil d'activite et les
 *    notifications partent DANS la transaction du fait qu'ils racontent. Une
 *    activite ecrite apres coup, dans sa propre transaction, survivrait a
 *    l'annulation du devis qu'elle decrit.
 *  - `MailModule` : l'envoi d'un devis previent le contact du dossier par
 *    courriel — meme service que la facture et le mot de passe oublie, une seule
 *    implementation du message et du transport. Voir `common/mail/mail.module.ts`.
 *
 * PAS DE `PrismaModule` NI DE `AuditModule` ICI : tous deux sont globaux
 * (`@Global()`), donc leurs services s'injectent sans import.
 *
 * LE SENS DES DEPENDANCES : `quotes` lit CINQ FICHIERS PARTAGES ranges dans le
 * dossier `invoices/` — `money.ts` (l'arithmetique decimale, seul endroit ou un
 * montant se calcule), `billing-access.ts` (le perimetre client),
 * `unique-violation.ts` (la detection de P2002), `audience.ts` (les comptes de
 * l'espace client) et `request-meta.ts` (l'IP et l'agent). Ce sont des FONCTIONS,
 * pas un service : aucun cycle de modules Nest n'en resulte, et `QuotesModule`
 * n'importe donc PAS `InvoicesModule`.
 *
 * `QuotesService` est exporte pour les modules qui auront besoin des REGLES du
 * devis. `InvoicesService` n'en fait pas partie, et c'est deliberе : sa
 * generation de facture RELIT le devis dans SA PROPRE transaction (statut et
 * lignes, sous `canInvoiceQuote`), parce qu'un aller-retour par un second service
 * rouvrirait une lecture hors transaction — entre la verification du statut et la
 * copie des lignes, un devis pourrait changer d'etat. L'export reste : le jour ou
 * un module voisin (relances, tableau de bord) voudra lire un devis, il passera
 * par ici plutot que de reecrire une requete sur `quotes`.
 */
@Module({
  imports: [ClientsModule, CountersModule, ActivityModule, NotificationModule, MailModule],
  controllers: [QuotesController],
  providers: [QuotesService],
  exports: [QuotesService],
})
export class QuotesModule {}
