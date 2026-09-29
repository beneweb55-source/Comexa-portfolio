import { randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

/**
 * Hachage des mots de passe — Argon2id.
 *
 * Aucun mot de passe en clair n'est jamais stocke, journalise ou renvoye. Ce
 * fichier est le SEUL endroit du backend qui sait hacher : dupliquer ces
 * parametres ailleurs garantirait qu'une copie derive, et une verification
 * serait un jour faite avec des parametres plus faibles que le hachage.
 */

/**
 * `2` est Argon2id dans @node-rs/argon2 (Argon2d = 0, Argon2i = 1).
 *
 * Ecrit en clair, et non `Algorithm.Argon2id`, pour une raison precise : dans
 * ce paquet, `Algorithm` est un `declare const enum`. TypeScript l'inline a la
 * compilation, mais il n'existe AUCUN objet a l'execution. L'importer se
 * compile donc sans broncher, puis casse a l'execution sous tsx ou esbuild, qui
 * ne peuvent pas inliner un enum defini dans un autre module. Une primitive de
 * securite ne doit pas dependre d'un detail de bundler.
 */
const ARGON2ID = 2;

/**
 * 19 Mio de memoire, 2 iterations, 1 thread : les valeurs recommandees par
 * l'OWASP pour Argon2id.
 *
 * `parallelism: 1` est volontaire. Chaque thread alloue son PROPRE pool de
 * `memoryCost` octets : passer a 4 threads quadruple la memoire consommee par
 * chaque hachage. Sur un serveur qui traite des connexions concurrentes, c'est
 * un moyen simple de se faire tomber par manque de memoire.
 */
const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** Hache un mot de passe. Le sel est genere et embarque dans la chaine. */
export function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTIONS);
}

/**
 * Verifie un mot de passe contre son empreinte.
 *
 * Les parametres ne sont pas repasses ici : ils sont inclus dans l'empreinte
 * elle-meme (format PHC). C'est ce qui permettra de durcir les parametres plus
 * tard sans invalider les mots de passe existants — les anciens resteront
 * verifiables, et seront rehaches a la prochaine connexion reussie.
 *
 * Toute erreur renvoie `false`. Une empreinte illisible ne doit jamais devenir
 * un acces accorde par le jeu des exceptions.
 */
export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(storedHash, plain);
  } catch {
    return false;
  }
}

/** Mot de passe aleatoire pour les comptes crees par l'administration ou le seed. */
export function generateStrongPassword(): string {
  // 18 octets -> 24 caracteres base64url, soit environ 144 bits d'entropie.
  //
  // Tirage PAR REJET, et non un simple tirage. Un mot de passe aleatoire de 24
  // caracteres ne contient aucun chiffre dans environ 1,6 % des cas : l'alphabet
  // base64url compte 52 lettres et 10 chiffres, donc (54/64)^24 ≈ 0,016. Ces
  // 1,6 % produisaient un mot de passe que `passwordPolicyViolation` refuse —
  // un generateur qui viole sa propre politique.
  //
  // Concretement, sans ce filtre : un parcours de reinitialisation remettrait a
  // l'utilisateur une valeur que le changement de mot de passe refuserait
  // ensuite, avec un message incomprehensible (« il manque un chiffre ») pour un
  // mot de passe que le systeme vient lui-meme de produire.
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = randomBytes(18).toString('base64url');
    if (passwordPolicyViolation(candidate) === null) {
      return candidate;
    }
  }

  // Inatteignable en pratique : la probabilite d'echouer 100 fois de suite est
  // de l'ordre de 10^-180. On leve plutot que de renvoyer une valeur non
  // verifiee — un mot de passe faible ne doit pas sortir d'ici par une porte de
  // service.
  throw new Error('Impossible de generer un mot de passe conforme apres 100 tentatives.');
}

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;

/**
 * Une petite liste de mots de passe tres courants.
 *
 * Ce n'est pas une protection serieuse contre un attaquant : c'est un filtre
 * contre l'utilisateur qui choisit `Motdepasse123!` en croyant satisfaire les
 * regles de composition. Les vraies defenses sont le hachage Argon2id et le
 * verrouillage apres echecs repetes.
 */
const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  'password1234',
  'motdepasse',
  'motdepasse1',
  'motdepasse123',
  'motdepasse1234',
  'azerty123456',
  'qwerty123456',
  '123456789012',
  'administrateur',
  'administrateur1',
  'comexa123456',
  'welcome12345',
  'letmein12345',
  'iloveyou123',
  'soleil123456',
]);

/**
 * Verifie la robustesse d'un mot de passe.
 *
 * Renvoie `null` si le mot de passe convient, sinon la RAISON du refus — en
 * francais, destinee a l'utilisateur. On ne leve pas d'exception ici : c'est au
 * DTO et au service de decider du code d'erreur a renvoyer, et un mot de passe
 * faible est une erreur de validation parmi d'autres, pas un incident.
 */
export function passwordPolicyViolation(plain: string, email?: string): string | null {
  if (plain.length < PASSWORD_MIN_LENGTH) {
    return `Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caracteres.`;
  }
  if (plain.length > PASSWORD_MAX_LENGTH) {
    return `Le mot de passe ne doit pas depasser ${PASSWORD_MAX_LENGTH} caracteres.`;
  }
  if (!/[a-z]/.test(plain)) {
    return 'Le mot de passe doit contenir au moins une lettre minuscule.';
  }
  if (!/[A-Z]/.test(plain)) {
    return 'Le mot de passe doit contenir au moins une lettre majuscule.';
  }
  if (!/[0-9]/.test(plain)) {
    return 'Le mot de passe doit contenir au moins un chiffre.';
  }
  // Comparaison sur une forme NORMALISEE : minuscules, ponctuation retiree.
  //
  // Une comparaison stricte laissait passer `MotDePasse123!`, `mot de passe 123`
  // ou `M0tDePasse123!` alors que `motdepasse123` est refuse : il suffisait
  // d'ajouter un caractere pour contourner la liste. On compare donc la forme
  // reduite, ce qui rend la ponctuation sans effet.
  const normalised = plain.toLowerCase().replace(/[^a-z0-9]/g, '');

  if (COMMON_PASSWORDS.has(normalised)) {
    return 'Ce mot de passe est trop courant. Choisissez-en un autre.';
  }

  if (email) {
    const localPart = email.split('@')[0]?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? '';
    if (localPart.length >= 4 && normalised.includes(localPart)) {
      return "Le mot de passe ne doit pas contenir votre adresse e-mail.";
    }
  }

  return null;
}
