import type { Prisma } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';

/**
 * DESTINATAIRES COTE CLIENT.
 *
 * Un devis part chez le client, une facture part chez le client, un encaissement
 * se confirme au client. Dans les trois cas il faut repondre a la meme question :
 * « quels COMPTES de l'espace client representent ce dossier ? ».
 *
 * La reponse n'est PAS `clients.email` : le schema n'en porte pas, et quand bien
 * meme — un courriel n'est pas un compte. Un dossier client peut avoir plusieurs
 * porteurs (un dirigeant, un comptable), certains archives, d'autres jamais
 * actives. La question se pose donc sur `users.clientId`, et sur des comptes
 * utilisables.
 *
 * Un compte supprime (`deletedAt`) ou non actif (`status`) est EXCLU : ecrire
 * une notification a un compte archive, c'est ecrire une ligne que personne ne
 * lira jamais et faire croire, dans les tests comme dans les statistiques, que
 * le client a ete informe.
 *
 * La fonction accepte le client transactionnel (`tx`) pour que la liste des
 * destinataires soit lue dans la MEME transaction que le fait qui la declenche :
 * un compte client cree juste avant l'acceptation du devis doit recevoir la
 * notification.
 */
export async function clientPortalUserIds(
  clientId: string | null,
  db: Prisma.TransactionClient | PrismaService,
): Promise<string[]> {
  if (!clientId) {
    return [];
  }

  const users = await db.user.findMany({
    where: {
      clientId,
      deletedAt: null,
      status: 'ACTIVE',
    },
    select: { id: true },
  });

  return users.map((user) => user.id);
}

/** Client Prisma ou transaction en cours, selon l'appelant. */
export type BillingDb = Prisma.TransactionClient | PrismaService;

/**
 * ADRESSE POSTALE DU DOSSIER CLIENT — la deuxieme question de ce fichier.
 *
 * `clientPortalUserIds` repond a « quels COMPTES voient ce document dans
 * l'application ? ». Cette fonction repond a « a quelle ADRESSE envoie-t-on le
 * courriel ? ». Ce sont deux questions distinctes, et les confondre est l'erreur
 * que ce fichier existe pour empecher :
 *
 *  - un compte de l'espace client n'est pas une boite aux lettres. Un dossier
 *    peut avoir des porteurs (un dirigeant, un comptable) dont aucun n'est le
 *    destinataire de la piece, et — c'est le cas le plus courant — un dossier
 *    SANS porteur du tout : un client cree depuis un prospect, dont le contact a
 *    une adresse mais pas encore de compte ;
 *  - une adresse, elle, ne se connecte pas. Le contact principal n'a pas
 *    forcement de compte, et c'est justement pourquoi la notification in-app ne
 *    suffit pas : sans courriel, il n'apprendrait rien du tout.
 *
 * L'ORDRE DE LECTURE EST LE CONTACT PRINCIPAL D'ABORD (`isPrimary` decroissant),
 * puis les autres par anciennete. Le repli n'est pas une commodite : un dossier
 * dont le contact marque principal n'a pas d'adresse ne doit pas laisser partir
 * un devis SANS QUE PERSONNE ne soit prevenu, alors qu'un second contact
 * joignable existe. Une adresse vide ou faite d'espaces est ecartee pour la meme
 * raison — une adresse vide en base vient d'une saisie abandonnee, pas d'un
 * destinataire.
 *
 * Renvoie `null` quand personne n'est joignable. Ce n'est PAS une erreur a lever
 * ici : l'appelant sait quoi en faire (il journalise et continue), et faire
 * echouer l'envoi d'une facture parce qu'un dossier n'a pas de contact joignable
 * serait exactement l'inverse du comportement voulu — le statut de la piece est
 * la verite, le courriel est un effet.
 *
 * `db` accepte la transaction de l'appelant, comme les autres fonctions de ce
 * fichier : l'adresse est ainsi lue dans la MEME transaction que le changement
 * d'etat qui la declenche, et un contact ajoute juste avant l'envoi est bien
 * celui qui recoit la piece.
 */
export interface BillingContact {
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
}

export async function primaryContactEmail(
  clientId: string | null,
  db: BillingDb,
): Promise<BillingContact | null> {
  if (!clientId) {
    return null;
  }

  const contacts = await db.contact.findMany({
    where: { clientId, deletedAt: null, email: { not: null } },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    select: { email: true, firstName: true, lastName: true },
  });

  for (const contact of contacts) {
    const email = contact.email?.trim();

    if (email) {
      return { email, firstName: contact.firstName, lastName: contact.lastName };
    }
  }

  return null;
}
