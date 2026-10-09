/**
 * Configuration de paiement FIXEE par les tests e2e, avant le chargement de
 * l'application. Un test ne doit pas dependre du `.env` du developpeur : la
 * valeur locale (ou de production) de PAYMENT_METHODS_DZD ne doit pas changer
 * le resultat des scenarios.
 *
 *  - DZD vide : un compte algerien ne peut pas commander en ligne (demande de
 *    projet proposee), tant qu'aucun moyen n'est configure pour le DZD ;
 *  - EUR = BANK_TRANSFER : un compte etranger peut commander en EUR.
 *
 * DOIT etre importe avant `app.module.js` (les modules lisent l'environnement
 * au chargement).
 */
process.env.PAYMENT_METHODS_DZD = '';
process.env.PAYMENT_METHODS_EUR = 'BANK_TRANSFER';

export {};
