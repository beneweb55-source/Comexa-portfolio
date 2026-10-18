import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Codes d'erreur stables, destines au FRONTEND.
 *
 * Le message est fait pour un humain et peut etre traduit ou reformule ; le
 * code, lui, ne change jamais. C'est ce que le frontend teste (`if (code ===
 * 'QUOTE_ALREADY_ACCEPTED')`) et c'est ce qui permet de reformuler un message
 * sans casser un ecran.
 */
export enum ErrorCode {
  /** Le corps de la requete ne respecte pas le contrat du DTO. */
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  /** Aucun jeton fourni, ou jeton illisible. */
  UNAUTHENTICATED = 'UNAUTHENTICATED',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  ACCOUNT_LOCKED = 'ACCOUNT_LOCKED',
  ACCOUNT_SUSPENDED = 'ACCOUNT_SUSPENDED',
  /**
   * Compte cree mais jamais active (invitation non acceptee). Distinct de
   * `ACCOUNT_SUSPENDED` : personne n'a rien decide contre ce compte, il attend
   * simplement que son titulaire ouvre le lien d'invitation. Le frontend doit
   * afficher un message different — « demandez un nouveau lien » n'a aucun sens
   * pour un compte suspendu, et « contactez un administrateur » n'en a aucun
   * pour un compte jamais active.
   */
  ACCOUNT_INVITED = 'ACCOUNT_INVITED',
  /**
   * L'utilisateur est authentifie mais doit d'abord changer son mot de passe.
   *
   * C'est le cas des comptes crees par un administrateur, qui connait donc le
   * mot de passe initial. Tant que ce code est renvoye, toutes les routes sont
   * fermees sauf celles qui permettent justement de sortir de cet etat.
   */
  PASSWORD_CHANGE_REQUIRED = 'PASSWORD_CHANGE_REQUIRED',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  TOKEN_INVALID = 'TOKEN_INVALID',
  REFRESH_TOKEN_REUSED = 'REFRESH_TOKEN_REUSED',
  /** Authentifie, mais sans le droit necessaire. */
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  /** Violation d'une contrainte d'unicite. */
  CONFLICT = 'CONFLICT',
  /** Etat metier incompatible avec l'operation demandee. */
  UNPROCESSABLE = 'UNPROCESSABLE',
  RATE_LIMITED = 'RATE_LIMITED',
  PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE',
  /** Erreur inattendue : le detail reste dans les journaux, pas dans la reponse. */
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
}

/** Corps d'une reponse en erreur. Forme contractuelle, ne pas modifier. */
export interface ApiErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    details: unknown;
  };
}

/**
 * Exception applicative.
 *
 * Le filtre global la traduit en `{ success: false, error: { code, message,
 * details } }`. Le point important : on ne leve jamais une `HttpException` nue
 * dans le code metier, parce qu'elle ne porte pas de code exploitable par le
 * frontend.
 */
export class AppException extends HttpException {
  readonly code: string;
  readonly details: unknown;

  constructor(
    code: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    details: unknown = null,
  ) {
    super({ code, message, details }, status);
    this.code = code;
    this.details = details;
  }

  /** 404. `code` doit suivre la convention `RESSOURCE_NOT_FOUND`. */
  static notFound(code: string, message: string): AppException {
    return new AppException(code, message, HttpStatus.NOT_FOUND);
  }

  /** 403. Le sujet est authentifie mais n'a pas le droit. */
  static forbidden(message = 'Acces refuse'): AppException {
    return new AppException(ErrorCode.FORBIDDEN, message, HttpStatus.FORBIDDEN);
  }

  /** 409. Doublon, ou ressource deja dans l'etat demande. */
  static conflict(code: string, message: string): AppException {
    return new AppException(code, message, HttpStatus.CONFLICT);
  }

  /** 422. La requete est bien formee mais l'etat metier l'interdit. */
  static unprocessable(code: string, message: string, details: unknown = null): AppException {
    return new AppException(code, message, HttpStatus.UNPROCESSABLE_ENTITY, details);
  }

  /** 400. Entree invalide. */
  static badRequest(code: string, message: string, details: unknown = null): AppException {
    return new AppException(code, message, HttpStatus.BAD_REQUEST, details);
  }

  /**
   * 500. Invariant interne violé : le code a détecté un état qui ne devrait pas
   * exister (une somme qui ne boucle pas, un taux sans source). Ce n'est ni la
   * faute de la requête — un 400 ferait retenter le client pour rien — ni un
   * état métier légitime — un 409 laisserait croire qu'il y a un choix à faire.
   *
   * `code` suit la convention des autres fabriques (`RESSOURCE_PROBLEME`), et il
   * est bien le code renvoyé au frontend : c'est lui qui permet de journaliser
   * et d'alerter sur une cause précise. Le statut 500 dit, lui, que le client
   * n'y peut rien.
   */
  static internal(code: string, message: string, details: unknown = null): AppException {
    return new AppException(code, message, HttpStatus.INTERNAL_SERVER_ERROR, details);
  }

  /** 401. */
  static unauthenticated(
    code: string = ErrorCode.UNAUTHENTICATED,
    message = 'Authentification requise',
  ): AppException {
    return new AppException(code, message, HttpStatus.UNAUTHORIZED);
  }
}
