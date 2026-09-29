import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module.js';
import { CountersModule } from '../counters/counters.module.js';
import { InvoicesModule } from '../invoices/invoices.module.js';
import { NotificationModule } from '../notifications/notification.module.js';
import { InvoicePaymentsController } from './invoice-payments.controller.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';

/**
 * Module des PAIEMENTS.
 *
 * QUATRE DEPENDANCES.
 *
 *  - `InvoicesModule` : c'est la dependance qui structure le module, et elle
 *    merite d'etre justifiee. Les paiements appellent DEUX methodes de
 *    `InvoicesService` — `lockForPayment` (le verrou de la facture, pris dans la
 *    transaction de l'encaissement) et `recomputePaymentState` (le seul ecrivain
 *    de `amountPaid`, `status` et `paidAt`). Ni l'une ni l'autre ne peut etre
 *    reecrite ici : la premiere est du SQL brut (`SELECT … FOR UPDATE`) dont la
 *    justification vit dans `invoices/invoice-lock.ts`, la seconde est la machine
 *    a etats des factures, qui n'a rien a faire dans le module qui encaisse.
 *  - `CountersModule` : la reference `PAY-2026-0001`, reservee DANS la
 *    transaction du paiement — un echec plus loin annule le numero au lieu de
 *    laisser un trou dans la numerotation.
 *  - `ActivityModule` et `NotificationModule` : l'activite et la confirmation au
 *    client, ecrites dans la meme transaction que l'encaissement.
 *
 * LE CYCLE EST EVITE PAR CONSTRUCTION : `InvoicesModule` n'importe PAS
 * `PaymentsModule`. Le controleur `POST /invoices/:id/payments` vit donc ici
 * (`InvoicePaymentsController`) et non cote factures — sans quoi les deux modules
 * s'importeraient mutuellement et il faudrait un `forwardRef`, c'est-a-dire une
 * injection dont l'ordre de resolution depend du moment.
 *
 * PAS DE `PrismaModule` NI DE `AuditModule` : tous deux sont globaux (`@Global()`).
 *
 * `PaymentsService` est exporte : c'est par lui que passeront les remboursements
 * et les rapprochements, quand ils existeront, plutot que par de nouvelles
 * lectures de `payments` dans un autre module.
 */
@Module({
  imports: [CountersModule, InvoicesModule, ActivityModule, NotificationModule],
  controllers: [PaymentsController, InvoicePaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
