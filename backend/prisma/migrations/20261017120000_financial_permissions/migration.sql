-- FAMILLE FINANCIERE : LES DROITS QUI MANQUAIENT.
--
-- Pourquoi ce fichier existe : les modules `balances`, `currencies`,
-- `exchange-rates` et `distributions` sont ecrits, testes et montes dans
-- `AppModule`... mais AUCUN role ne portait les droits de les lire. Le
-- catalogue des permissions ne contenait pas une seule ligne `balance:*`,
-- `currency:*`, `exchangerate:*` ou `distribution:*`, donc
-- `AccessPolicy.requireScope('balance', 'read', ['own'])` echouait pour TOUT
-- le monde, administrateur compris : un 403 « Droit insuffisant :
-- balance:read » sur une route qui n'a rien de sensible.
--
-- Consequence cote interface : « Mon compte » ne pouvait pas afficher le solde,
-- parce qu'il n'y avait pas de donnee a afficher cote serveur. C'est aussi ce
-- qui rendait la suite de tests du catalogue rouge : ce test verifie que tout
-- code utilise par un `requireScope` existe bien au catalogue.
--
-- Ces permissions sont inserees ICI, et non seulement dans le seed : un
-- deploiement « migrations seulement » (sans reseed) doit laisser les roles
-- avec leurs droits. Toutes les instructions sont idempotentes — `migrate
-- deploy` peut etre relance, et un reseed ulterieur ne duplique rien.
--
-- `balance:read:own`   : le solde du porteur (par devise).
-- `balance:read:any`   : le solde de n'importe quel membre (administration).
-- `balance:manage:any` : l'ajustement manuel d'un solde (administration).
--
-- Le role CLIENT est VOLONTAIREMENT absent : un solde est ce que l'agence doit
-- a un membre de l'equipe (repartitions, commissions), pas un avoir client.

-- --------------------------------------------------------------------------------------
-- Permissions (idempotent)
-- --------------------------------------------------------------------------------------
INSERT INTO "permissions" ("id", "code", "resource", "action", "scope", "description", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text,
       codes.code,
       split_part(codes.code, ':', 1),
       split_part(codes.code, ':', 2),
       split_part(codes.code, ':', 3),
       codes.description,
       NOW(), NOW()
FROM (VALUES
    ('balance:read:own', 'Consulter son propre solde'),
    ('balance:read:any', 'Consulter les soldes des membres'),
    ('balance:manage:any', 'Ajuster les soldes des membres'),
    ('currency:read:any', 'Consulter les devises'),
    ('currency:manage:any', 'Gerer les devises'),
    ('exchangerate:read:any', 'Consulter les taux de change'),
    ('exchangerate:manage:any', 'Gerer les taux de change'),
    ('distribution:read:any', 'Consulter les repartitions de gains'),
    ('distribution:manage:any', 'Creer et appliquer les repartitions de gains')
) AS codes(code, description)
WHERE NOT EXISTS (
    SELECT 1 FROM "permissions" p WHERE p.code = codes.code
);

-- --------------------------------------------------------------------------------------
-- Attribution aux roles (idempotent)
-- --------------------------------------------------------------------------------------

-- L'ADMIN porte 'ALL' au seed, mais une base deployee avant ce fichier n'a pas
-- l'expansion : on lui accorde donc explicitement les neuf codes.
INSERT INTO "role_permissions" ("roleId", "permissionId", "createdAt")
SELECT r."id", p."id", NOW()
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
    'balance:read:own',
    'balance:read:any',
    'balance:manage:any',
    'currency:read:any',
    'currency:manage:any',
    'exchangerate:read:any',
    'exchangerate:manage:any',
    'distribution:read:any',
    'distribution:manage:any'
)
WHERE r."code" = 'ADMIN'
ON CONFLICT DO NOTHING;

-- Chaque membre de l'equipe voit SON solde : c'est la contrepartie de la
-- repartition qu'il encaisse. Ni `read:any` ni `manage:any` : voir le solde
-- d'un collegue et l'ajuster restent des actes d'administration.
INSERT INTO "role_permissions" ("roleId", "permissionId", "createdAt")
SELECT r."id", p."id", NOW()
FROM "roles" r
JOIN "permissions" p ON p."code" = 'balance:read:own'
WHERE r."code" IN (
    'COMMUNICATION_MANAGER',
    'PROJECT_MANAGER',
    'DEVELOPER',
    'DESIGNER',
    'SALES'
)
ON CONFLICT DO NOTHING;

-- Le chef de projet pilote les montants : il lit les devises et les taux, et
-- il consulte les repartitions d'un projet. Il ne les gere pas : creer une
-- configuration de repartition ou l'appliquer credited des soldes, et le
-- controleur du module reserve deja cette action a l'ADMIN.
INSERT INTO "role_permissions" ("roleId", "permissionId", "createdAt")
SELECT r."id", p."id", NOW()
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
    'currency:read:any',
    'exchangerate:read:any',
    'distribution:read:any'
)
WHERE r."code" = 'PROJECT_MANAGER'
ON CONFLICT DO NOTHING;

-- Le commercial annonce des prix : il lit les devises et les taux. Il ne gere
-- ni devise ni repartition.
INSERT INTO "role_permissions" ("roleId", "permissionId", "createdAt")
SELECT r."id", p."id", NOW()
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
    'currency:read:any',
    'exchangerate:read:any'
)
WHERE r."code" = 'SALES'
ON CONFLICT DO NOTHING;
