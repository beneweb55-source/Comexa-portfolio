import { Transform } from 'class-transformer';

/**
 * CONVERSIONS D'ENTREE, PARTAGEES PAR LES DTO DU MODULE CONTENU.
 *
 * Deux conversions reviennent sur presque tous les champs, et elles traitent
 * toutes les deux le meme probleme : ce qui arrive par HTTP n'est jamais du
 * JSON typé.
 *
 * Elles vivent dans un fichier a part plutot que d'etre recopiees dans chaque
 * DTO. Une conversion subtile recopiee finit toujours par diverger : l'une
 * gererait la chaine vide, l'autre non, et le meme formulaire marcherait sur un
 * champ et pas sur son voisin.
 *
 * ELLES N'ONT PAS LEUR PLACE DANS `src/common/` ICI : ces deux-ci sont locales
 * au contenu, et promouvoir un helper au tronc commun se decide quand un
 * deuxieme domaine en a besoin — pas avant.
 *
 * UNE TROISIEME CONVERSION — LE BOOLEEN — A VECU ICI, ET N'Y EST PLUS.
 * Elle portait un defaut qu'aucune relecture ne voyait : sans la metadonnee
 * `@Type(() => String)`, la conversion implicite de class-transformer lui
 * livrait un booleen deja calcule, et `?isActive=false` arrivait en `true` —
 * l'inverse exact de la demande. Trente et un champs la subissaient.
 * Le helper correct vit dans `src/common/dto/boolean-filter.ts`, avec la garde
 * de type qui rend la conversion seulement possible. Ne pas en reecrire un ici.
 */

/**
 * Une chaine vide vaut « champ absent ».
 *
 * Un formulaire HTML envoie `name=` et non l'absence du champ, et un client JSON
 * fait souvent de meme. Or `@IsOptional()` de class-validator ne saute que `null`
 * et `undefined` : sans cette conversion, un `@MinLength(1)` refuserait une
 * requete parfaitement normale avec un message incomprehensible.
 *
 * La valeur est aussi detouree : `"  Bordeaux  "` et `"Bordeaux"` doivent etre le
 * meme nom une fois en base.
 */
export const emptyToUndefined = (): PropertyDecorator =>
  Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  });

/**
 * Un tableau de chaines venant d'un formulaire.
 *
 * En JSON, un tableau arrive tel quel. En multipart ou en `x-www-form-urlencoded`,
 * il arrive tantot repete (`features=a&features=b`), tantot separe par des
 * virgules. Les deux formes doivent produire le meme resultat, sinon le meme
 * contenu se cree differemment selon l'encodage utilise par le client.
 *
 * Une chaine vide donne un tableau VIDE, et non `['']` : une liste de points
 * forts contenant une entree vide afficherait une puce sans texte sur la page
 * publique.
 */
export const toStringArray = (): PropertyDecorator =>
  Transform(({ value }: { value: unknown }) => {
    if (Array.isArray(value)) {
      return value
        .map((entry) => (typeof entry === 'string' ? entry.trim() : entry))
        .filter((entry) => typeof entry !== 'string' || entry.length > 0);
    }

    if (typeof value !== 'string') return value;

    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  });
