-- Appairage Telegram multi-utilisateur : chaque membre lie son compte Comexa
-- a son identifiant Telegram pour utiliser @ComexaWork_bot avec ses propres droits.
--
-- Le code d'appairage a 6 chiffres n'est jamais stocke en clair : seule son
-- empreinte SHA-256 est conservee, avec une expiration courte (10 minutes).

-- CreateTable
CREATE TABLE IF NOT EXISTS "telegram_links" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "telegramUserId" TEXT,
    "telegramChatId" TEXT,
    "telegramUsername" TEXT,
    "pairingCodeHash" TEXT,
    "pairingExpiresAt" TIMESTAMP(3),
    "pairedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (idempotent via IF NOT EXISTS, supported from PostgreSQL 11)
CREATE UNIQUE INDEX IF NOT EXISTS "telegram_links_userId_key" ON "telegram_links"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "telegram_links_telegramUserId_key" ON "telegram_links"("telegramUserId");
CREATE INDEX IF NOT EXISTS "telegram_links_pairingCodeHash_idx" ON "telegram_links"("pairingCodeHash");
CREATE INDEX IF NOT EXISTS "telegram_links_revokedAt_idx" ON "telegram_links"("revokedAt");

-- AddForeignKey
ALTER TABLE "telegram_links" DROP CONSTRAINT IF EXISTS "telegram_links_userId_fkey";
ALTER TABLE "telegram_links" ADD CONSTRAINT "telegram_links_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Insere la permission telegram:link:any si absente (idempotent).
INSERT INTO "permissions" ("id", "code", "resource", "action", "scope", "description")
SELECT 'perm_telegram_link_any', 'telegram:link:any', 'telegram', 'link', 'any', 'Lier et resoudre des comptes Telegram via le bot @ComexaWork_bot'
WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE "code" = 'telegram:link:any');

-- Accord de la permission a ADMIN (idempotent).
-- ADMIN recoit 'ALL' par ROLE_PERMISSIONS ; cette insertion ne concerne que
-- les installations ou ADMIN aurait ete configure avec une liste explicite.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id
FROM "roles" r
JOIN "permissions" p ON p.code = 'telegram:link:any'
WHERE r.code = 'ADMIN'
  AND NOT EXISTS (
    SELECT 1 FROM "role_permissions" rp
    WHERE rp."roleId" = r.id AND rp."permissionId" = p.id
  );
