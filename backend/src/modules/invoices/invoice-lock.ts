import type { Prisma } from '../../generated/prisma/client.js';

/**
 * VERROU DE LIGNE SUR UNE FACTURE.
 *
 * C'est le SEUL `FOR UPDATE` du module de facturation, et il protege exactement
 * une chose : le controle de solde avant enregistrement d'un paiement.
 *
 * LE PROBLEME, EN DEUX TRANSACTIONS SIMULTANEES. Une facture de 1000 EUR deja
 * reglee a 200. Deux encaissements de 800 arrivent en meme temps.
 *
 *   T1 : lit `amountPaid = 200`  ->  solde 800  ->  800 <= 800 : accepte
 *   T2 : lit `amountPaid = 200`  ->  solde 800  ->  800 <= 800 : accepte
 *   T1 : ecrit un paiement de 800, puis `amountPaid = 1000`
 *   T2 : ecrit un paiement de 800, puis `amountPaid = 1000`
 *
 * Resultat : 1600 EUR encaisses sur une facture de 1000, et une colonne
 * `amountPaid` qui n'en montre que 1000. Le solde lu et l'ecriture qui en
 * depend ne sont pas la meme operation, et entre les deux il y a une fenetre.
 * Aucun controle ecrit APRES la lecture ne referme cette fenetre.
 *
 * TROIS CHOSES QUI NE MARCHENT PAS, ET QU'IL NE FAUT PAS REESSAYER :
 *
 *  1. verifier le solde en SQL (`WHERE amountPaid + 800 <= total`) — Prisma ne
 *     l'exprime pas, et le faire en `$executeRaw` deplace le probleme sans le
 *     resoudre : il faudrait toujours lire le total dans la meme instruction ;
 *  2. relire la somme APRES l'insertion, sous READ COMMITTED — la relecture ne
 *     voit pas le paiement non valide de l'autre transaction, et la seconde
 *     validation passe ;
 *  3. compter sur le verrou qu'un `UPDATE` prend sur la ligne — il est reel,
 *     mais il n'arrive qu'APRES le controle, donc trop tard ; et sous READ
 *     COMMITTED, la transaction qui attend reevalue la ligne seulement pour son
 *     `WHERE`, pas la lecture qui a servi au controle.
 *
 * CE QUI MARCHE : prendre le verrou AVANT de lire, dans la transaction qui va
 * ecrire. Le `SELECT ... FOR UPDATE` serialise les encaissements d'une meme
 * facture — le second attend le commit du premier, puis relit un solde a jour,
 * et se fait refuser si le compte n'y est plus. Deux paiements sur des factures
 * DIFFERENTES ne s'attendent pas : le verrou est par ligne.
 *
 * PORTEE : le verrou tient jusqu'au commit ou au rollback de la transaction
 * appelante. Il doit donc etre pris dans la transaction qui ecrit le paiement,
 * et jamais dans une transaction plus courte (le verrou serait relache avant
 * l'ecriture) ni plus longue que necessaire (il bloquerait les encaissements des
 * autres factures si l'appelant verrouillait plusieurs lignes d'un coup).
 *
 * `SELECT id` plutot que `SELECT *` : la valeur lue ne sert pas, seule la ligne
 * verrouillee compte, et une colonne suffit a l'exprimer.
 */
export async function lockInvoice(
  tx: Prisma.TransactionClient,
  invoiceId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM invoices WHERE id = ${invoiceId} FOR UPDATE
  `;

  // `false` signifie « cette facture n'existe pas » — l'appelant repond 404. Ce
  // n'est pas une erreur ici : le verrou d'une ligne absente n'existe pas, et
  // lever depuis cette fonction priverait l'appelant du choix du code d'erreur.
  return rows.length > 0;
}
