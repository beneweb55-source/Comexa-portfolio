import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marque une route comme accessible SANS authentification.
 *
 * Le garde d'authentification global refuse par defaut : une route n'est
 * publique que si quelqu'un l'a ecrit explicitement. C'est le sens de la
 * securite par defaut — oublier d'annoter une route la rend PROTEGEE, pas
 * ouverte. L'erreur penche du bon cote.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
