-- RENOMMAGE DU ROLE DESIGNER EN SOCIAL_MEDIA_MANAGER (« Gestion reseaux sociaux »).
--
-- C'est un RENOMMAGE PUR, decide comme tel : le nouveau role conserve
-- exactement les 26 permissions de l'ancien Designer (le meme jeu que
-- DEVELOPER, voir `backend/src/common/auth/permissions.catalogue.ts`, la source
-- de verite). Aucun droit n'est ajoute ni retire, aucun espace ne s'ouvre ni ne
-- se ferme (espace personnel et espace equipe, toujours pas de Comexa Space).
--
-- `RENAME VALUE` renomme la valeur d'enumeration SUR PLACE : la ligne de
-- `roles` garde son `id`, donc `user_roles` (les comptes porteurs) et
-- `role_permissions` (les 26 droits) suivent sans etre touches — un compte
-- Designer devient Gestion reseaux sociaux avec ses projets, ses taches
-- assignees et son historique intacts. C'est pour cela qu'on ne cree PAS un
-- nouveau role suivi d'une recopie des attributions : la recopie est
-- exactement le genre d'etape ou un compte perd son role en route.
--
-- Le libelle est mis a jour ICI, et pas seulement dans le seed : un
-- deploiement « migrations seulement » (sans reseed) doit afficher le bon nom.
-- La page Membres de Comexa Space construit son filtre « Role » depuis
-- `roles.name` (via `GET /roles`), pas depuis un libelle cote frontend.
--
-- Ce qui n'est volontairement PAS reecrit : les instantanes JSON du journal
-- d'audit (`audit_logs.before` / `after`) qui mentionnent `DESIGNER`. Ce sont
-- des faits passes, pas une source de verite — les reecrire falsifierait
-- l'historique sans rien proteger.

ALTER TYPE "RoleCode" RENAME VALUE 'DESIGNER' TO 'SOCIAL_MEDIA_MANAGER';

UPDATE "roles"
SET "name" = 'Gestion reseaux sociaux',
    "description" = 'Gere les reseaux sociaux ; travaille sur les taches qui lui sont assignees.',
    "updatedAt" = NOW()
WHERE "code" = 'SOCIAL_MEDIA_MANAGER';
