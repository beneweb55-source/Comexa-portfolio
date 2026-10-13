-- Jetons d'integration : acces serveur-a-serveur (n8n, agents IA).
--
-- Pourquoi un compte technique par jeton : des dizaines d'ecritures portent une
-- cle etrangere vers `users` (auteur d'une activite, createur d'une tache,
-- expediteur d'un message). Une integration sans ligne dans `users` ne pourrait
-- rien ecrire sans casser ces contraintes, et il aurait fallu rendre toutes ces
-- colonnes nullables — au prix de la tracabilite. `User.isServiceAccount`
-- distingue ces comptes des membres : ils sont exclus des listes d'utilisateurs,
-- n'ont aucun role, et leur mot de passe est un secret que personne ne detient.
--
-- LE JETON EN CLAIR N'EST JAMAIS STOCKE : `tokenHash` est son empreinte SHA-256.
-- Une fuite de la base ne livre donc aucun jeton utilisable.
--
-- Garanties de ce fichier :
--  - chaque instruction est idempotente : `migrate deploy` peut etre relance ;
--  - `ON DELETE CASCADE` sur le compte technique : revoquer puis supprimer une
--    integration ne laisse pas de jeton orphelin en base ;
--  - les permissions d'integration sont INSEREES ici et accordees a ADMIN, comme
--    pour le calendrier : un deploiement « migrations seulement » ne laisse
--    aucun role sans droits.
--  - `accountId` est UNIQUE : un compte technique ne porte qu'un seul jeton, ce
--    qui rend la tracabilite sans ambiguite (une action = une integration).

-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "isServiceAccount" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE IF NOT EXISTS "integration_tokens" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "accountId" TEXT NOT NULL,
    "createdById" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "integration_tokens_name_key" ON "integration_tokens"("name");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "integration_tokens_tokenHash_key" ON "integration_tokens"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "integration_tokens_accountId_key" ON "integration_tokens"("accountId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "integration_tokens_revokedAt_idx" ON "integration_tokens"("revokedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "integration_tokens_expiresAt_idx" ON "integration_tokens"("expiresAt");

-- AddForeignKey
ALTER TABLE "integration_tokens" DROP CONSTRAINT IF EXISTS "integration_tokens_accountId_fkey";
ALTER TABLE "integration_tokens" ADD CONSTRAINT "integration_tokens_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_tokens" DROP CONSTRAINT IF EXISTS "integration_tokens_createdById_fkey";
ALTER TABLE "integration_tokens" ADD CONSTRAINT "integration_tokens_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- PERMISSIONS D'INTEGRATION (idempotent)
-- ---------------------------------------------------------------------------
INSERT INTO "permissions" ("id", "code", "resource", "action", "scope", "description", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text,
       codes.code,
       split_part(codes.code, ':', 1),
       split_part(codes.code, ':', 2),
       split_part(codes.code, ':', 3),
       codes.description,
       NOW(), NOW()
FROM (VALUES
    ('integration:read:any', 'Consulter les jetons d''integration'),
    ('integration:manage:any', 'Creer, renouveler et revoquer les jetons d''integration')
) AS codes(code, description)
WHERE NOT EXISTS (
    SELECT 1 FROM "permissions" p WHERE p.code = codes.code
);

-- Seul ADMIN gere les integrations : c'est lui qui peut donner a une machine un
-- acces aux donnees de l'agence. `ON CONFLICT DO NOTHING` : un reseed plus tard
-- ne duplique rien.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
    'integration:read:any',
    'integration:manage:any'
)
WHERE r."code" = 'ADMIN'
ON CONFLICT DO NOTHING;
