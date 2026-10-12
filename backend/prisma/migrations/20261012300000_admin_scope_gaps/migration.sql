-- COMBLEMENT DES SCOPES DE L'ADMIN SUR UNE BASE EXISTANTE.
--
-- Pourquoi ce fichier existe : le role ADMIN porte 'ALL', mais cette expansion
-- a lieu AU SEED, quand les lignes `role_permissions` sont inserees. Une base
-- mise en production AVANT les P1/P2/P3 garde l'expansion d'ALORS : l'admin y
-- manque les scopes apparus depuis (`time:*:own` ne concernait pas l'admin,
-- `calendar:*` n'existait pas). Les migrations P1/P2 et calendrier ont bien
-- comble les ROLES MEMBRES, mais l'admin n'a recu que `calendar:manage:any`.
--
-- Sans ce fichier, un administrateur sur une base ancienne recoit un 403 sur
-- son PROPRE calendrier (`calendar:read:own` manquant) — exactement le genre de
-- panne silencieuse qui ne se voit qu'en production. Tout est idempotent :
-- `migrate deploy` peut etre relance, et un reseed plus tard ne change rien
-- (les lignes existantes ne sont jamais dupliquees).

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
    'time:read:own',
    'time:write:own',
    'task:read:personal',
    'task:write:personal',
    'calendar:read:own',
    'calendar:write:own'
)
WHERE r."code" = 'ADMIN'
ON CONFLICT DO NOTHING;
