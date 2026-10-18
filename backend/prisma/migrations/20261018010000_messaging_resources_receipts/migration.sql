-- =============================================================================
-- MESSAGERIE AMÉLIORÉE — ressources partagées, accusés de lecture, statut de
-- livraison, conversations de groupe.
--
-- Les modèles `MessageResource`, `MessageReadReceipt`, les champs
-- `Conversation.isGroup / groupName / groupDescription` et
-- `Message.deliveryStatus` existaient dans le schéma sans migration : les
-- tables et colonnes correspondantes n'ont jamais été créées en base.
--
-- CE QUE ÇE DÉBLOQUE, concrètement :
--   * le partage de ressources dans le chat (un message peut pointer un
--     projet, une tâche, un devis, une facture, un paiement, un document ou
--     un client, avec un aperçu) — c'est la brique du « chat qui redirige
--     vers les projets et les pages » du tableau de bord ;
--   * les accusés de lecture par destinataire dans les groupes : on sait QUI
--     a lu QUOI, pas seulement qu'un message a été ouvert ;
--   * le statut de livraison (SENT → DELIVERED → READ), porté par le message
--     lui-même pour les conversations directes ;
--   * les conversations de groupe (nom, description), qui n'étaient qu'un
--     booléen jamais créé.
--
-- `SharedResourceType` inclut les sept types partageables. FOLDER a été
-- écarté : aucun modèle « dossier » n'existe, et un type sans ressource
-- réelle produit des liens morts.
--
-- Idempotence : mêmes règles que les migrations précédentes.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ÉNUMÉRATIONS (idempotentes)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "MessageDeliveryStatus" AS ENUM ('SENT', 'DELIVERED', 'READ');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "SharedResourceType" AS ENUM ('PROJECT', 'TASK', 'QUOTE', 'INVOICE', 'PAYMENT', 'DOCUMENT', 'CLIENT');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ---------------------------------------------------------------------------
-- COLONNES AJOUTÉES
-- ---------------------------------------------------------------------------

-- AlterTable — conversations de groupe
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "isGroup" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "groupName" TEXT;
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "groupDescription" TEXT;

-- AlterTable — statut de livraison, SENT par défaut (un message est écrit
-- avant d'être distribué ; l'état initial reflète l'ordre des faits).
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "deliveryStatus" "MessageDeliveryStatus" NOT NULL DEFAULT 'SENT';

-- ---------------------------------------------------------------------------
-- RESSOURCES PARTAGÉES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "message_resources" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "resourceType" "SharedResourceType" NOT NULL,
    "resourceId" TEXT NOT NULL,
    "previewTitle" TEXT,
    "previewText" TEXT,
    "sharedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_resources_pkey" PRIMARY KEY ("id")
);

-- Un message ne partage pas deux fois la même ressource.
CREATE UNIQUE INDEX IF NOT EXISTS "message_resources_messageId_resourceType_resourceId_key" ON "message_resources"("messageId", "resourceType", "resourceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "message_resources_messageId_idx" ON "message_resources"("messageId");

-- CreateIndex — retrouver tous les messages qui partagent une ressource
-- donnée (« où ce projet a-t-il été mentionné ? »).
CREATE INDEX IF NOT EXISTS "message_resources_resourceType_resourceId_idx" ON "message_resources"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "message_resources_sharedById_idx" ON "message_resources"("sharedById");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "message_resources" ADD CONSTRAINT "message_resources_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "message_resources" ADD CONSTRAINT "message_resources_sharedById_fkey" FOREIGN KEY ("sharedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ---------------------------------------------------------------------------
-- ACCUSÉS DE LECTURE
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "message_read_receipts" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,

    CONSTRAINT "message_read_receipts_pkey" PRIMARY KEY ("id")
);

-- Un seul accusé de lecture par message ET par utilisateur.
CREATE UNIQUE INDEX IF NOT EXISTS "message_read_receipts_messageId_userId_key" ON "message_read_receipts"("messageId", "userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "message_read_receipts_messageId_idx" ON "message_read_receipts"("messageId");

-- CreateIndex — « quels messages untel a-t-il lus, et quand ? »
CREATE INDEX IF NOT EXISTS "message_read_receipts_userId_readAt_idx" ON "message_read_receipts"("userId", "readAt");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "message_read_receipts" ADD CONSTRAINT "message_read_receipts_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "message_read_receipts" ADD CONSTRAINT "message_read_receipts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
