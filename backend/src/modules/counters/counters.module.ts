import { Module } from '@nestjs/common';
import { CounterService } from './counter.service.js';

/**
 * MODULE DE NUMEROTATION.
 *
 * Fichier nomme au PLURIEL (`counters.module.ts`, classe `CountersModule`) comme
 * `REFERENCE_PREFIXES` couvre plusieurs portees : client, projet, devis, facture,
 * paiement. C'est aussi le nom que les modules voisins importent.
 *
 * Sans controleur, et c'est deliberé : on ne « consomme » pas un numero par HTTP.
 * Un endpoint `GET /counters/next` distribuerait des numeros a qui le demande, y
 * compris pour des documents jamais crees, et surtout HORS de la transaction du
 * document — exactement ce que ce module existe pour empecher. Un numero se
 * reserve dans la transaction qui cree la piece, jamais avant.
 *
 * `CounterService` est exporte pour que les modules client, projet, devis,
 * facture et paiement l'injectent. `PrismaModule` est global : rien d'autre a
 * importer ici, et surtout pas un module metier — le compteur ne doit dependre
 * d'aucun domaine, sans quoi le premier import circulaire ferait tomber
 * l'injection au demarrage.
 */
@Module({
  providers: [CounterService],
  exports: [CounterService],
})
export class CountersModule {}
