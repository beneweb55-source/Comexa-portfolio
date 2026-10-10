import type { MailAddress } from './mail.types.js';

/**
 * Decomposition de `SMTP_FROM` en adresse et nom.
 *
 * POURQUOI CE FICHIER EXISTE, ET POURQUOI IL N'EST PAS DANS UN TRANSPORT.
 * Cette fonction a d'abord vecu dans le fichier du transport HTTP, parce que
 * c'est l'arrivee de ce transport qui avait rendu la decomposition necessaire :
 * l'API attend `{ Email, Name }` la ou le SMTP attend une chaine unique
 * (« Comexa <no-reply@comexa.com> »). C'etait une erreur de rangement, et le
 * remplacement du fournisseur l'a montree : la fonction sert les DEUX transports,
 * et l'une des deux valeurs qu'elle produit finit dans un en-tete SMTP que l'autre
 * transport ne voit jamais. Tant qu'elle habitait un fichier portant le nom d'un
 * fournisseur, remplacer ce fournisseur ressemblait a une operation qui touchait
 * au parsing de l'expediteur — et un test qui aurait du suivre la fonction
 * disparaissait avec le fichier.
 *
 * LA VARIABLE RESTE AU FORMAT SMTP. Deux variables pour la meme information
 * (`SMTP_FROM` et une hypothetique `MAIL_FROM_EMAIL`) finiraient par se
 * desaccorder, et c'est l'expediteur qui est verifie chez le fournisseur : un
 * desaccord la se voit tout de suite, sous la forme d'un refus a chaque envoi.
 *
 * UNE ADRESSE SYNTAXIQUEMENT IMPOSSIBLE LEVE, AU DEMARRAGE. Un expediteur
 * malforme ne produirait sinon que des refus a chaque envoi, c'est-a-dire une
 * panne decouverte par un client qui ne recoit pas son lien de reinitialisation.
 */

/**
 * Decompose une chaine d'expediteur en adresse et nom.
 *
 * Accepte les deux formes reelles : « Comexa <no-reply@comexa.com> » et
 * « no-reply@comexa.com ». Les guillemets apparies autour du nom ou de
 * l'adresse sont retires, parce qu'un tableau de bord d'hebergeur les conserve
 * volontiers tels qu'ils ont ete saisis.
 */
export function parseSender(raw: string): MailAddress {
  // LES GUILLEMETS SONT RETIRES AVANT LE MOTIF, ET PAS SEULEMENT APRES.
  // C'est le cas de tres loin le plus courant en pratique : un fichier `.env`
  // ecrit `SMTP_FROM="Comexa <a@b.c>"`, et le modele du depot fait exactement
  // ca. Or tous les lecteurs ne retirent pas ces guillemets — `docker run
  // --env-file` les conserve tels quels, et un tableau de bord d'hebergeur le
  // fait volontiers aussi. Sans ce retrait, la valeur recue finit par un
  // guillemet, le motif d'angle ne s'applique donc plus, et l'adresse retournee
  // devient la chaine ENTIERE : elle contient une arobase, donc elle franchit
  // la verification ci-dessous, et le fournisseur refuse ensuite chaque envoi
  // en designant un expediteur que personne n'a jamais ecrit.
  const value = unquote(raw.trim());
  const angled = /^(.*?)\s*<\s*([^<>]+?)\s*>$/.exec(value);

  // Les groupes sont lus avec un repli explicite, et non par confiance :
  // `noUncheckedIndexedAccess` les type `string | undefined`. Le groupe 1 est
  // `.*?`, donc legitimement vide (« <a@b.c> », sans nom d'affichage) ; le
  // groupe 2 est exige par le motif, mais s'il etait vide la verification
  // d'adresse plus bas leve avec un message qui dit quoi corriger, ce qu'un
  // `!` n'aurait pas fait.
  const name = angled ? unquote((angled[1] ?? '').trim()) : '';
  const email = unquote((angled ? (angled[2] ?? '') : value).trim());

  if (!email.includes('@')) {
    throw new Error(
      `SMTP_FROM ne contient pas d'adresse d'expedition valide : « ${raw} ». ` +
        'Format attendu : « Comexa <no-reply@comexa.com> » ou « no-reply@comexa.com ». ' +
        "L'adresse doit etre un expediteur valide chez le fournisseur d'envoi.",
    );
  }

  return name ? { email, name } : { email };
}

/** Enleve les guillemets qui entourent un nom ou une adresse, s'ils sont apparies. */
function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' || first === "'") && first === last) {
      return value.slice(1, -1).trim();
    }
  }
  return value;
}
