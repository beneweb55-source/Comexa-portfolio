import { isISO8601, registerDecorator, type ValidationOptions } from 'class-validator';

/**
 * `@IsDateStringLike()` — une date au format ISO 8601, en chaine.
 *
 * POURQUOI PAS `@IsDateString()` DE class-validator DIRECTEMENT.
 *
 * Il fait exactement le meme controle, mais son message par defaut est en
 * anglais (« must be a valid ISO 8601 date string ») et il faudrait donc le
 * reecrire a chaque propriete — dix fois dans ce domaine. Un message par defaut
 * en anglais dans une API dont toutes les erreurs sont en francais finit par
 * remonter tel quel a l'ecran, parce que personne ne pense a le reecrire sur la
 * onzieme propriete ajoutee.
 *
 * POURQUOI UNE CHAINE ET NON UN `Date`.
 *
 * `ValidationPipe` tourne avec `enableImplicitConversion`, qui convertirait un
 * `Date` a partir de la metadonnee de type. La conversion d'une chaine ISO vers
 * `Date` passe alors par `new Date(...)`, qui accepte beaucoup de choses
 * (« 2026-13-45 », « demain ») et rend une date invalide sans le dire. Ici, la
 * validation ISO est faite AVANT toute conversion, et le service convertit
 * lui-meme une valeur dont il sait qu'elle est valide.
 */
export function IsDateStringLike(options?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol): void => {
    registerDecorator({
      name: 'isDateStringLike',
      target: object.constructor,
      propertyName: String(propertyName),
      options,
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && isISO8601(value, { strict: true });
        },
        defaultMessage(): string {
          return 'La date doit etre au format ISO 8601 (exemple : 2026-10-01T00:00:00.000Z).';
        },
      },
    });
  };
}
