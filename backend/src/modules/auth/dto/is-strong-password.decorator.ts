import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { passwordPolicyViolation } from '../../../common/security/password.js';

/**
 * Verifie la politique de mot de passe AU NIVEAU DU DTO.
 *
 * Ce decorateur n'implemente aucune regle : il appelle `passwordPolicyViolation`,
 * exactement la meme fonction que `AuthService` avant de hacher. C'est le point
 * important. Dupliquer les regles — `@MinLength(12)` d'un cote, une liste de
 * mots de passe courants de l'autre — garantit qu'elles divergent un jour, et
 * qu'un mot de passe accepte en HTTP soit refuse par le service, ou l'inverse.
 * Ici, les deux appellent la meme fonction : elles ne peuvent pas se contredire.
 *
 * Le decorateur sert au MESSAGE (un 400 de validation, precis et immediat) ;
 * le service revalide parce que tout ce qui ecrit un mot de passe doit passer
 * par la politique, y compris un chemin qui n'est pas un controleur.
 */

function reasonFor(value: unknown, args: ValidationArguments): string | null {
  if (typeof value !== 'string') {
    return 'Le mot de passe est obligatoire.';
  }

  // Le DTO voisin porte l'adresse e-mail, et la politique refuse un mot de
  // passe qui contient la partie locale de l'adresse. On la lit ici pour que
  // `monentreprise2026!` attache a `monentreprise@exemple.fr` soit refuse des la
  // validation.
  const email = (args.object as { email?: unknown }).email;

  return passwordPolicyViolation(value, typeof email === 'string' ? email : undefined);
}

@ValidatorConstraint({ name: 'isStrongPassword', async: false })
export class IsStrongPasswordConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    return reasonFor(value, args) === null;
  }

  defaultMessage(args: ValidationArguments): string {
    return (
      reasonFor(args.value, args) ?? 'Le mot de passe ne respecte pas la politique de securite.'
    );
  }
}

export function IsStrongPassword(options?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol): void => {
    registerDecorator({
      name: 'isStrongPassword',
      target: object.constructor,
      propertyName: String(propertyName),
      options,
      validator: IsStrongPasswordConstraint,
    });
  };
}
