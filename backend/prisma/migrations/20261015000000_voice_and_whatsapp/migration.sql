-- =============================================================================
-- Vocaux Telegram et passerelle WhatsApp
-- =============================================================================
-- Le bot @ComexaWork_bot (workflow n8n) recoit des messages VOCAUX et peut
-- envoyer des WhatsApp via un compte appaire. Cote base, cinq tables :
--
--   voice_transcripts   la transcription, et la cle de rejeu qui evite de la
--                       payer deux fois (`telegramFileId` unique)
--   whatsapp_accounts   une session de passerelle + l'autorisation qui va avec
--   whatsapp_delegations le consentement d'un TIERS, prouve par un code
--   whatsapp_contacts   cache du repertoire, avec la date de synchronisation
--   whatsapp_messages   journal des envois, ecrit AVANT l'appel a la passerelle
--
-- Garanties de ce fichier :
--  - chaque instruction est idempotente : `migrate deploy` peut etre relance ;
--  - AUCUN identifiant de session WhatsApp n'est stocke ici : la passerelle
--    (WAHA / Evolution) detient les cookies et les cles, Comexa ne garde que le
--    NOM de session. Une fuite de la base ne donne donc pas acces aux comptes ;
--  - les permissions nouvelles sont INSEREES ici (comme pour `telegram:link:any`) :
--    un deploiement « migrations seulement » ne laisse aucun role sans droits ;
--  - deux contraintes CHECK portent des regles metier que Prisma n'exprime pas :
--    une delegation sans compte delegue est impossible, et un envoi marque
--    `SENT` porte obligatoirement une date.

-- CreateEnum (idempotent : `duplicate_object` si le type existe deja)
DO $$ BEGIN
  CREATE TYPE "WhatsAppSessionStatus" AS ENUM ('DISCONNECTED', 'STARTING', 'WAITING_QR', 'CONNECTED', 'FAILED', 'REVOKED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "WhatsAppOwnerKind" AS ENUM ('SELF', 'DELEGATED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "WhatsAppDelegationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REFUSED', 'EXPIRED', 'REVOKED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "WhatsAppMessageDirection" AS ENUM ('OUTBOUND', 'INBOUND');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "WhatsAppMessageStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'REFUSED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- -----------------------------------------------------------------------------
-- Transcriptions de messages vocaux
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "voice_transcripts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "telegramUserId" TEXT NOT NULL,
    "telegramChatId" TEXT,
    "telegramMessageId" TEXT,
    "telegramFileId" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "durationSeconds" INTEGER,
    "language" TEXT,
    "text" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "requestedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_transcripts_pkey" PRIMARY KEY ("id")
);

-- La cle de rejeu : un meme fichier Telegram n'est transcrit qu'une fois.
CREATE UNIQUE INDEX IF NOT EXISTS "voice_transcripts_telegramFileId_key" ON "voice_transcripts"("telegramFileId");
CREATE INDEX IF NOT EXISTS "voice_transcripts_userId_createdAt_idx" ON "voice_transcripts"("userId", "createdAt");
-- Sert le balayage de retention (`TRANSCRIPT_RETENTION_DAYS`) : sans index sur
-- la date, chaque purge parcourt la table entiere.
CREATE INDEX IF NOT EXISTS "voice_transcripts_createdAt_idx" ON "voice_transcripts"("createdAt");

DO $$ BEGIN
  ALTER TABLE "voice_transcripts" ADD CONSTRAINT "voice_transcripts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "voice_transcripts" ADD CONSTRAINT "voice_transcripts_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- -----------------------------------------------------------------------------
-- Delegations : le consentement d'un tiers
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "whatsapp_delegations" (
    "id" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "delegatorName" TEXT,
    "delegatorEmail" TEXT,
    "delegatorPhone" TEXT,
    "delegatorTelegramUserId" TEXT,
    "delegatorTelegramChatId" TEXT,
    "note" TEXT,
    "status" "WhatsAppDelegationStatus" NOT NULL DEFAULT 'PENDING',
    "grantedScopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "codeHash" TEXT,
    "codeExpiresAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "acceptedIpAddress" TEXT,
    "refusedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_delegations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_delegations_codeHash_key" ON "whatsapp_delegations"("codeHash");
CREATE INDEX IF NOT EXISTS "whatsapp_delegations_status_codeExpiresAt_idx" ON "whatsapp_delegations"("status", "codeExpiresAt");
CREATE INDEX IF NOT EXISTS "whatsapp_delegations_requestedById_idx" ON "whatsapp_delegations"("requestedById");

DO $$ BEGIN
  ALTER TABLE "whatsapp_delegations" ADD CONSTRAINT "whatsapp_delegations_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- -----------------------------------------------------------------------------
-- Comptes WhatsApp appaires
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "whatsapp_accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ownerKind" "WhatsAppOwnerKind" NOT NULL DEFAULT 'SELF',
    "gatewayDriver" TEXT NOT NULL,
    "sessionName" TEXT NOT NULL,
    "status" "WhatsAppSessionStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "phoneNumber" TEXT,
    "pushName" TEXT,
    "grantedScopes" TEXT[] NOT NULL DEFAULT ARRAY['message:send']::TEXT[],
    "consentVersion" TEXT NOT NULL,
    "consentAcceptedAt" TIMESTAMP(3),
    "consentIpAddress" TEXT,
    "consentExpiresAt" TIMESTAMP(3),
    "pairedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastStatusAt" TIMESTAMP(3),
    "lastError" TEXT,
    "delegationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_accounts_pkey" PRIMARY KEY ("id"),
    -- Un compte delegue pointe OBLIGATOIREMENT vers la delegation qui le
    -- justifie. Sans cette contrainte, `ownerKind = DELEGATED` pourrait etre
    -- ecrit sans aucune trace de consentement — exactement ce que le modele
    -- existe pour empecher.
    CONSTRAINT "whatsapp_accounts_delegated_needs_delegation_check"
      CHECK ("ownerKind" <> 'DELEGATED' OR "delegationId" IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_accounts_sessionName_key" ON "whatsapp_accounts"("sessionName");
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_accounts_delegationId_key" ON "whatsapp_accounts"("delegationId");
CREATE INDEX IF NOT EXISTS "whatsapp_accounts_userId_status_idx" ON "whatsapp_accounts"("userId", "status");
CREATE INDEX IF NOT EXISTS "whatsapp_accounts_status_idx" ON "whatsapp_accounts"("status");
CREATE INDEX IF NOT EXISTS "whatsapp_accounts_revokedAt_idx" ON "whatsapp_accounts"("revokedAt");

DO $$ BEGIN
  ALTER TABLE "whatsapp_accounts" ADD CONSTRAINT "whatsapp_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "whatsapp_accounts" ADD CONSTRAINT "whatsapp_accounts_delegationId_fkey" FOREIGN KEY ("delegationId") REFERENCES "whatsapp_delegations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- -----------------------------------------------------------------------------
-- Contacts mis en cache
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "whatsapp_contacts" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "jid" TEXT NOT NULL,
    "phoneNumber" TEXT,
    "name" TEXT,
    "isBusiness" BOOLEAN NOT NULL DEFAULT false,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_contacts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_contacts_accountId_jid_key" ON "whatsapp_contacts"("accountId", "jid");
CREATE INDEX IF NOT EXISTS "whatsapp_contacts_accountId_name_idx" ON "whatsapp_contacts"("accountId", "name");

DO $$ BEGIN
  ALTER TABLE "whatsapp_contacts" ADD CONSTRAINT "whatsapp_contacts_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "whatsapp_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- -----------------------------------------------------------------------------
-- Journal des messages
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "whatsapp_messages" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "direction" "WhatsAppMessageDirection" NOT NULL DEFAULT 'OUTBOUND',
    "toJid" TEXT NOT NULL,
    "toPhoneNumber" TEXT,
    "body" TEXT NOT NULL,
    "status" "WhatsAppMessageStatus" NOT NULL DEFAULT 'QUEUED',
    "gatewayMessageId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "requestedById" TEXT,
    "telegramChatId" TEXT,
    "telegramMessageId" TEXT,
    "idempotencyKey" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id"),
    -- Un envoi confirme porte une date. La colonne existerait sinon pour
    -- decorer, et un journal dont la date manque est un journal qu'on ne peut
    -- pas opposer a un destinataire.
    CONSTRAINT "whatsapp_messages_sent_needs_date_check"
      CHECK ("status" <> 'SENT' OR "sentAt" IS NOT NULL)
);

-- Rejeu sans double envoi. Les `idempotencyKey` NULL ne se contredisent jamais :
-- PostgreSQL traite les NULL comme distincts dans un index unique.
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_messages_accountId_idempotencyKey_key" ON "whatsapp_messages"("accountId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "whatsapp_messages_accountId_createdAt_idx" ON "whatsapp_messages"("accountId", "createdAt");
CREATE INDEX IF NOT EXISTS "whatsapp_messages_status_idx" ON "whatsapp_messages"("status");
-- Sert le plafond horaire d'envoi : compter les messages de l'heure sans cet
-- index revient a parcourir tout l'historique a chaque envoi.
CREATE INDEX IF NOT EXISTS "whatsapp_messages_accountId_status_sentAt_idx" ON "whatsapp_messages"("accountId", "status", "sentAt");

DO $$ BEGIN
  ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "whatsapp_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- -----------------------------------------------------------------------------
-- Permissions
-- -----------------------------------------------------------------------------
-- Codes au format `resource:action:scope` (trois segments, voir
-- `permissions.catalogue.ts`). L'insertion est idempotente : un rejeu ne cree
-- pas de doublon et n'ecrase pas une description modifiee a la main.
INSERT INTO "permissions" ("id", "code", "resource", "action", "scope", "description")
SELECT * FROM (VALUES
  ('perm_telegram_transcribe_any', 'telegram:transcribe:any', 'telegram', 'transcribe', 'any', 'Transcrire les messages vocaux recus par le bot'),
  ('perm_whatsapp_link_any', 'whatsapp:link:any', 'whatsapp', 'link', 'any', 'Appairer, interroger et revoquer les sessions WhatsApp via la passerelle'),
  ('perm_whatsapp_send_any', 'whatsapp:send:any', 'whatsapp', 'send', 'any', 'Envoyer un message WhatsApp depuis un compte autorise'),
  ('perm_whatsapp_read_any', 'whatsapp:read:any', 'whatsapp', 'read', 'any', 'Consulter les contacts et le journal des envois WhatsApp'),
  ('perm_whatsapp_delegate_any', 'whatsapp:delegate:any', 'whatsapp', 'delegate', 'any', 'Demander a un tiers l’autorisation d’envoyer via son compte WhatsApp'),
  ('perm_whatsapp_manage_any', 'whatsapp:manage:any', 'whatsapp', 'manage', 'any', 'Administrer les comptes WhatsApp et leurs autorisations')
) AS new_permissions ("id", "code", "resource", "action", "scope", "description")
WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE "permissions"."code" = new_permissions."code");

-- ADMIN recoit 'ALL' par ROLE_PERMISSIONS ; cette insertion ne concerne que les
-- installations ou ADMIN aurait ete configure avec une liste explicite.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id
FROM "roles" r
JOIN "permissions" p ON p.code IN (
  'telegram:transcribe:any',
  'whatsapp:link:any',
  'whatsapp:send:any',
  'whatsapp:read:any',
  'whatsapp:delegate:any',
  'whatsapp:manage:any'
)
WHERE r.code = 'ADMIN'
  AND NOT EXISTS (
    SELECT 1 FROM "role_permissions" rp
    WHERE rp."roleId" = r.id AND rp."permissionId" = p.id
  );
