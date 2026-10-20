import { SetMetadata, applyDecorators } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marque une route comme accessible SANS authentification.
 *
 * Le garde d'authentification global refuse par defaut : une route n'est
 * publique que si quelqu'un l'a ecrit explicitement. C'est le sens de la
 * securite par defaut — oublier d'annoter une route la rend PROTEGEE, pas
 * ouverte. L'erreur penche du bon cote.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI CE DECORATEUR ECRIT AUSSI DANS LA DOCUMENTATION OPENAPI
 * ---------------------------------------------------------------------------
 * Le document genere declare une exigence de securite GLOBALE
 * (`addSecurityRequirements('access-token')` dans `app.setup.ts`). Ce n'est pas
 * un raccourci : c'est la description exacte du montage, puisque `JwtAuthGuard`
 * est enregistre en `APP_GUARD` et protege donc TOUTE route sauf mention
 * contraire. Sans exigence globale, il faudrait annoter a la main les ~146
 * operations protegees, et le document deviendrait faux des la premiere route
 * ajoutee sans annotation — silencieusement.
 *
 * Mais une exigence globale se paie d'un contresens : les routes ouvertes
 * seraient decrites comme protegees. Swagger UI afficherait un cadenas sur
 * `/api/health`, et un frontend qui se fie a cette documentation enverrait un
 * jeton la ou il n'en faut pas. Les routes publiques doivent donc dire le
 * contraire ELLES-MEMES, en declarant `security: []` — c'est-a-dire « aucune »,
 * ce qui n'est PAS la meme chose que « non declare », qui herite du global.
 *
 * Fusionner les deux declarations ici plutot que de les repeter sur chaque route
 * donne l'invariant suivant : une route ne peut pas devenir publique sans que sa
 * documentation suive. Le document OpenAPI etant produit par la meme fonction
 * d'assemblage que le serveur, l'invariant tient sur le document reellement
 * genere, et non sur une intention.
 *
 * ---------------------------------------------------------------------------
 * LE `summary: undefined` N'EST PAS UNE NEGLIGENCE
 * ---------------------------------------------------------------------------
 * `ApiOperation` injecte TOUJOURS un `summary: ''` par defaut :
 *
 *     pickBy({ ...defaultOperationOptions, ...options }, negate(isUndefined))
 *
 * Or `@Public()` est ecrit EN HAUT du gestionnaire dans tout ce depot :
 *
 *     @Public()                                      <- applique EN DERNIER
 *     @Get('services')
 *     @ApiOperation({ summary: 'Services actifs' })  <- applique EN PREMIER
 *
 * Les decorateurs de methode s'appliquent de bas en haut, et la fusion faite par
 * `@nestjs/swagger` est `{ ...precedent, ...nouveau }`. Le `summary: ''`
 * implicite ecraserait donc le resume des dix-neuf routes publiques du depot,
 * qui se retrouveraient toutes avec un titre vide dans Swagger UI — une
 * regression invisible en compilation comme en test d'execution.
 *
 * Le passer explicitement a `undefined` le fait retirer par le `pickBy`
 * ci-dessus, et la fusion conserve le resume ecrit par la route.
 * C'est exactement le genre d'astuce qu'un futur nettoyage pourrait supprimer en
 * croyant bien faire : la ligne n'est donc pas un detail, elle porte le resume
 * de dix-neuf routes a la fois.
 */
export const Public = () =>
  applyDecorators(
    SetMetadata(IS_PUBLIC_KEY, true),
    ApiOperation({ security: [], summary: undefined }),
  );
