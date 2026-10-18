-- =============================================================================
-- FONDATION FINANCIÈRE — devises, taux de change, répartitions, soldes membres.
--
-- Cette migration crée ce que le schéma déclarait depuis les phases 1 à 3 mais
-- qu'aucune migration n'avait jamais créé en base. Sans elle :
--   * `prisma migrate deploy` ne crée pas les tables, donc `CurrencyService`,
--     `ExchangeRateService`, `DistributionService` et `BalanceService` parlent
--     à des tables inexistantes (500 à la première requête) ;
--   * `clients.currency`, `*.currencyId` et `users.preferredCurrency`
--     manquent, alors que les DTO et les services les écrivent déjà.
--
-- CHOIX ASSUMÉS, et pourquoi :
--
--  1. LES DEVISES DE RÉFÉRENCE SONT INSÉRÉES ICI, pas seulement dans le seed.
--     Un déploiement « migrations seulement » (sans `db seed`) doit trouver le
--     dinar par défaut : `GET /currencies/default` alimente les formulaires de
--     devis et de factures. Même raison que les permissions d'intégration,
--     insérées dans leur migration. `ON CONFLICT DO NOTHING` rend l'opération
--     idempotente — un reseed plus tard ne duplique rien.
--
--  2. AUCUN TAUX DE CHANGE N'EST INSÉRÉ. La règle du modèle `ExchangeRate` est
--     explicite : un taux sans source vérifiable est un taux fictif, et un
--     taux fictif convertit mal une facture. Les taux se créent par
--     `POST /exchange-rates`, avec leur source.
--
--  3. LE DÉFAUT DE `currency` DEVIENT 'DZD' sur projets, devis, factures et
--     paiements. L'init avait posé 'EUR' (marché de démonstration) ; le schéma
--     dit aujourd'hui `@default("DZD")` — marché principal = Algérie. La base
--     est réalignée sur le schéma, qui est la source de vérité. Seule la
--     valeur PAR DÉFAUT change : les lignes existantes gardent leur devise,
--     car une facture déjà émise en EUR reste une facture en EUR.
--
--  4. `distribution_histories.changedById` est NOT NULL mais son action de
--     suppression est SET NULL (c'est ce que déclare le schéma). PostgreSQL
--     accepte la contrainte à la création ; en pratique un utilisateur
--     porteur d'un historique n'est jamais supprimé physiquement (suppression
--     douce), donc le cas ne se présente pas.
--
-- Idempotence : `IF NOT EXISTS` partout, `DROP CONSTRAINT IF EXISTS` avant
-- chaque `ADD CONSTRAINT`, `ON CONFLICT DO NOTHING` sur les insertions. Un
-- `migrate deploy` rejoué ne casse rien.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ÉNUMÉRATIONS (idempotentes)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "DistributionBaseType" AS ENUM ('INVOICED_AMOUNT', 'COLLECTED_AMOUNT', 'PROFIT_AFTER_EXPENSES');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "BeneficiaryType" AS ENUM ('MEMBER', 'COMPANY', 'RESERVE');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "DistributionStatus" AS ENUM ('PENDING', 'CALCULATED', 'APPLIED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "DistributionItemStatus" AS ENUM ('PENDING', 'CREDITED', 'PAID', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "DistributionChangeType" AS ENUM ('CONFIG_CHANGED', 'BASE_AMOUNT_UPDATED', 'MANUAL_ADJUSTMENT', 'PAYMENT_RECEIVED', 'DISTRIBUTION_APPLIED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "BalanceTransactionType" AS ENUM ('CREDIT', 'DEBIT', 'CORRECTION');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "BalanceTransactionStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ---------------------------------------------------------------------------
-- DEVISES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "currencies" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(3) NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "currencies_code_key" ON "currencies"("code");

-- Devises de référence. DZD est la devise par défaut : marché principal.
-- EUR et USD sont proposées mais INACTIVES : elles s'activent quand un taux
-- vérifiable est saisi (POST /exchange-rates), jamais avant.
INSERT INTO "currencies" ("id", "code", "name", "symbol", "isActive", "isDefault", "createdAt", "updatedAt")
SELECT * FROM (VALUES
    (gen_random_uuid()::text, 'DZD', 'Dinar algérien', 'DA', true, true, NOW(), NOW()),
    (gen_random_uuid()::text, 'EUR', 'Euro', '€', false, false, NOW(), NOW()),
    (gen_random_uuid()::text, 'USD', 'Dollar américain', '$', false, false, NOW(), NOW())
) AS v("id", "code", "name", "symbol", "isActive", "isDefault", "createdAt", "updatedAt")
ON CONFLICT ("code") DO NOTHING;

-- ---------------------------------------------------------------------------
-- TAUX DE CHANGE
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "exchange_rates" (
    "id" TEXT NOT NULL,
    "fromCurrency" VARCHAR(3) NOT NULL,
    "toCurrency" VARCHAR(3) NOT NULL,
    "rate" DECIMAL(19,6) NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "exchange_rates_fromCurrency_toCurrency_effectiveDate_key" ON "exchange_rates"("fromCurrency", "toCurrency", "effectiveDate");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "exchange_rates_fromCurrency_toCurrency_idx" ON "exchange_rates"("fromCurrency", "toCurrency");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "exchange_rates_effectiveDate_idx" ON "exchange_rates"("effectiveDate");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_fromCurrency_fkey" FOREIGN KEY ("fromCurrency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_toCurrency_fkey" FOREIGN KEY ("toCurrency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ---------------------------------------------------------------------------
-- RÉPARTITIONS — configuration, bénéficiaires, parts, historique
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "distribution_configs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "baseType" "DistributionBaseType" NOT NULL DEFAULT 'COLLECTED_AMOUNT',
    "effectiveDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "distribution_configs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "distribution_beneficiaries" (
    "id" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "userId" TEXT,
    "beneficiaryType" "BeneficiaryType" NOT NULL,
    "name" TEXT NOT NULL,
    "percentage" DECIMAL(5,2) NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "distribution_beneficiaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "distribution_beneficiaries_configId_order_idx" ON "distribution_beneficiaries"("configId", "order");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "distribution_beneficiaries" ADD CONSTRAINT "distribution_beneficiaries_configId_fkey" FOREIGN KEY ("configId") REFERENCES "distribution_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "distribution_beneficiaries" ADD CONSTRAINT "distribution_beneficiaries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "project_distributions" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "baseAmount" DECIMAL(14,2) NOT NULL,
    "baseCurrency" VARCHAR(3) NOT NULL,
    "totalPercentage" DECIMAL(5,2) NOT NULL DEFAULT 100,
    "status" "DistributionStatus" NOT NULL DEFAULT 'PENDING',
    "calculatedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "appliedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_distributions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "project_distributions_projectId_configId_key" ON "project_distributions"("projectId", "configId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "project_distributions_projectId_idx" ON "project_distributions"("projectId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "project_distributions_configId_idx" ON "project_distributions"("configId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "project_distributions_status_idx" ON "project_distributions"("status");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "project_distributions" ADD CONSTRAINT "project_distributions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "project_distributions" ADD CONSTRAINT "project_distributions_configId_fkey" FOREIGN KEY ("configId") REFERENCES "distribution_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "project_distributions" ADD CONSTRAINT "project_distributions_appliedById_fkey" FOREIGN KEY ("appliedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "distribution_items" (
    "id" TEXT NOT NULL,
    "distributionId" TEXT NOT NULL,
    "beneficiaryId" TEXT NOT NULL,
    "calculatedAmount" DECIMAL(14,2) NOT NULL,
    "creditedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL,
    "status" "DistributionItemStatus" NOT NULL DEFAULT 'PENDING',
    "calculatedAt" TIMESTAMP(3),
    "creditedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "paymentReference" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "distribution_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "distribution_items_distributionId_beneficiaryId_key" ON "distribution_items"("distributionId", "beneficiaryId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "distribution_items_distributionId_idx" ON "distribution_items"("distributionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "distribution_items_beneficiaryId_idx" ON "distribution_items"("beneficiaryId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "distribution_items" ADD CONSTRAINT "distribution_items_distributionId_fkey" FOREIGN KEY ("distributionId") REFERENCES "project_distributions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- RESTRICT, et pas CASCADE : supprimer un bénéficiaire effacerait la part
-- calculée d'une répartition déjà appliquée. L'historique financier ne se
-- supprime pas en cascade.
DO $$ BEGIN
  ALTER TABLE "distribution_items" ADD CONSTRAINT "distribution_items_beneficiaryId_fkey" FOREIGN KEY ("beneficiaryId") REFERENCES "distribution_beneficiaries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "distribution_histories" (
    "id" TEXT NOT NULL,
    "distributionId" TEXT NOT NULL,
    "previousConfigId" TEXT,
    "changedById" TEXT NOT NULL,
    "changeType" "DistributionChangeType" NOT NULL,
    "oldValues" JSONB,
    "newValues" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "distribution_histories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "distribution_histories_distributionId_createdAt_idx" ON "distribution_histories"("distributionId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "distribution_histories_changedById_idx" ON "distribution_histories"("changedById");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "distribution_histories" ADD CONSTRAINT "distribution_histories_distributionId_fkey" FOREIGN KEY ("distributionId") REFERENCES "project_distributions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "distribution_histories" ADD CONSTRAINT "distribution_histories_previousConfigId_fkey" FOREIGN KEY ("previousConfigId") REFERENCES "distribution_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "distribution_histories" ADD CONSTRAINT "distribution_histories_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ---------------------------------------------------------------------------
-- SOLDES DES MEMBRES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "member_balances" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "currentBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "lastUpdatedAt" TIMESTAMP(3),
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_balances_pkey" PRIMARY KEY ("id")
);

-- Un solde par membre ET par devise : pas de conversion implicite, un solde
-- DZD et un solde EUR sont deux soldes distincts.
CREATE UNIQUE INDEX IF NOT EXISTS "member_balances_userId_currency_key" ON "member_balances"("userId", "currency");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "member_balances_userId_idx" ON "member_balances"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "member_balances_currency_idx" ON "member_balances"("currency");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "member_balances" ADD CONSTRAINT "member_balances_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "member_balances" ADD CONSTRAINT "member_balances_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "balance_transactions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "memberBalanceId" TEXT,
    "distributionItemId" TEXT,
    "projectId" TEXT,
    "paymentId" TEXT,
    "type" "BalanceTransactionType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "previousBalance" DECIMAL(14,2) NOT NULL,
    "newBalance" DECIMAL(14,2) NOT NULL,
    "reference" TEXT,
    "description" TEXT,
    "status" "BalanceTransactionStatus" NOT NULL DEFAULT 'CONFIRMED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "balance_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "balance_transactions_userId_createdAt_idx" ON "balance_transactions"("userId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "balance_transactions_userId_currency_createdAt_idx" ON "balance_transactions"("userId", "currency", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "balance_transactions_projectId_idx" ON "balance_transactions"("projectId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "balance_transactions_distributionItemId_idx" ON "balance_transactions"("distributionItemId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "balance_transactions_paymentId_idx" ON "balance_transactions"("paymentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "balance_transactions_memberBalanceId_idx" ON "balance_transactions"("memberBalanceId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "balance_transactions" ADD CONSTRAINT "balance_transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "balance_transactions" ADD CONSTRAINT "balance_transactions_memberBalanceId_fkey" FOREIGN KEY ("memberBalanceId") REFERENCES "member_balances"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "balance_transactions" ADD CONSTRAINT "balance_transactions_distributionItemId_fkey" FOREIGN KEY ("distributionItemId") REFERENCES "distribution_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "balance_transactions" ADD CONSTRAINT "balance_transactions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "balance_transactions" ADD CONSTRAINT "balance_transactions_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ---------------------------------------------------------------------------
-- COLONNES AJOUTÉES AUX TABLES EXISTANTES
-- ---------------------------------------------------------------------------

-- AlterTable — devise préférée d'affichage (ne modifie aucune donnée financière)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "preferredCurrency" VARCHAR(3);

-- AlterTable — devise du client (source de vérité pour ses futurs documents)
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'DZD';

-- AlterTable — liens optionnels vers les métadonnées de devise
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "currencyId" TEXT;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "currencyId" TEXT;
ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "currencyId" TEXT;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "currencyId" TEXT;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "currencyId" TEXT;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "clients" ADD CONSTRAINT "clients_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "projects" ADD CONSTRAINT "projects_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "quotes" ADD CONSTRAINT "quotes_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "invoices" ADD CONSTRAINT "invoices_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "payments" ADD CONSTRAINT "payments_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Realignement des valeurs PAR DEFAUT sur le schéma (`@default("DZD")`).
-- Seul le defaut change : une facture deja emise en EUR reste en EUR.
ALTER TABLE "projects" ALTER COLUMN "currency" SET DEFAULT 'DZD';
ALTER TABLE "quotes" ALTER COLUMN "currency" SET DEFAULT 'DZD';
ALTER TABLE "invoices" ALTER COLUMN "currency" SET DEFAULT 'DZD';
ALTER TABLE "payments" ALTER COLUMN "currency" SET DEFAULT 'DZD';
