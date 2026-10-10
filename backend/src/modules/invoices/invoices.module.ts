import { Module } from '@nestjs/common';
import { MailModule } from '../../common/mail/mail.module.js';
import { ActivityModule } from '../activity/activity.module.js';
import { CountersModule } from '../counters/counters.module.js';
import { NotificationModule } from '../notifications/notification.module.js';
import { InvoiceOverdueService } from './invoice-overdue.service.js';
import { InvoicesController } from './invoices.controller.js';
import { InvoicesService } from './invoices.service.js';
import { QuoteInvoiceController } from './quote-invoice.controller.js';

/**
 * Module des FACTURES.
 *
 * QUATRE DEPENDANCES, ET AUCUNE DE PLUS.
 *
 *  - `CountersModule` : le numero de la facture (`FAC-2026-0001`) et le couple
 *    `(sequence, year)` qui l'accompagne en base ;
 *  - `ActivityModule` et `NotificationModule` : le fil d'activite et la
 *    notification au client partent DANS la transaction du fait qu'ils racontent.
 *    Une activite ecrite apres coup, dans sa propre transaction, survivrait a
 *    l'echec de la facture qu'elle decrit.
 *  - `MailModule` : l'envoi d'une facture previent le contact du dossier par
 *    courriel. Le module est importe ICI, et non l'authentification, pour que la
 *    facturation n'ait pas a dependre d'`AuthModule` pour envoyer un message.
 *    Voir `common/mail/mail.module.ts`.
 *
 * PAS DE `QuotesModule` ICI, ET C'EST UN CHOIX. `InvoicesService.createFromQuote`
 * a besoin des regles du devis (un devis accepte, pas un devis en brouillon) et
 * du contenu de ses lignes : il importe `canInvoiceQuote` depuis
 * `quotes/quote-state.ts`, qui est un FICHIER DE FONCTIONS PURES, pas un module
 * Nest, et il RELIT le devis dans sa propre transaction. Importer `QuotesModule`
 * pour cela ferait dependre les factures d'un service dont les lectures ne
 * partagent pas la transaction de la facture — et une verification de statut hors
 * transaction ne vaut rien.
 *
 * LE SENS DES DEPENDANCES AU NIVEAU DES MODULES NEST RESTE DONC UNIDIRECTIONNEL :
 * `PaymentsModule` importe `InvoicesModule` (pour le verrou et le recalcul du
 * solde), jamais l'inverse. Les fichiers partages ranges dans ce dossier
 * (`money.ts`, `billing-access.ts`, `unique-violation.ts`, `audience.ts`,
 * `request-meta.ts`) sont importes par les devis et les paiements sans creer de
 * cycle, parce que ce sont des fonctions.
 *
 * PAS DE `PrismaModule` NI DE `AuditModule` : tous deux sont globaux (`@Global()`),
 * donc leurs services s'injectent sans import.
 *
 * `InvoiceOverdueService` EST FOURNI ICI, ET PAS DANS UN MODULE « TACHES ».
 * Le balayage des echeances ecrit des factures, lit leur solde et emet leurs
 * notifications : ses regles sont celles de la facturation, et un module
 * transversal devrait importer la facturation pour les appliquer. Il n'a pas de
 * controleur — c'est une tache planifiee, montee par `ScheduleModule` dans
 * `AppModule` des que cette classe est fournie quelque part. Le fournir ici rend
 * la dependance lisible : c'est le module des factures qui produit `OVERDUE`.
 */
@Module({
  imports: [CountersModule, ActivityModule, NotificationModule, MailModule],
  controllers: [InvoicesController, QuoteInvoiceController],
  providers: [InvoicesService, InvoiceOverdueService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
