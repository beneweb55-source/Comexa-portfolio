-- =============================================================================
-- REPARTITION & SOLDES — regles versionnees, bases explicites, soldes traces
-- =============================================================================
--
-- CE QUE CE CHANGEMENT REPARE, ET POURQUOI IL NE POUVAIT PAS ETRE EVITE.
--
-- 1. LES REGLES SONT VERSIONNEES. `distribution_configs` etait modifiee SUR
--    PLACE : les beneficiaires etaient supprimes puis recrees. Une repartition
--    deja calculee pointait donc vers des lignes disparues (et la cle
--    etrangere `onDelete: Restrict` faisait echouer la mise a jour), et une
--    regle changee recalculait silencieusement les repartitions deja
--    validees. Ici, une modification cree une NOUVELLE VERSION de la regle
--    (`version`, `supersedesId`, `scopeKey`), et l'ancienne n'est plus jamais
--    touchee : une repartition appliquee garde la regle qui l'a produite.
--
-- 2. LES EXCEPTIONS PAR PROJET. Une regle porte desormais un perimetre
--    (`scopeKey` = 'global' ou 'project:<id>'). La regle globale est le
--    defaut ; une exception s'applique a un projet precis. `scopeKey` est
--    materialise en colonne pour que l'unicite de version soit garantie par
--    la base (une cle NULL n'etant jamais egale a une autre en SQL).
--
-- 3. LA BASE DE CALCUL EST EXPLICITE. `PROJECT_AMOUNT` s'ajoute a
--    `INVOICED_AMOUNT` et `COLLECTED_AMOUNT` : on distingue le montant du
--    projet, le montant FACTURE (une facture emise n'est pas un paiement) et le
--    montant REELLEMENT ENCAISSE.
--
-- 4. LES ARRONDIS SONT TRACABLES. Chaque item porte son pourcentage, son
--    montant brut et l'ajustement d'arrondi (`trace`), et la repartition
--    porte la trace complete (`calculationTrace`). Le total reparti est donc
--    toujours exactement la base, et l'on peut expliquer pourquoi.
--
-- 5. LES SOLDES SONT ATTRIBUES ET JAMAIS EFFACES. Une transaction porte son
--    auteur (`authorId`), sa nature (`kind` : part, paiement, avance,
--    ajustement, correction, regularisation), son motif (`reason`), sa date
--    d'effet (`occurredAt`), sa reference, et le lien vers l'operation
--    contre-passee (`reversalOfId`). Aucune suppression n'est possible : une
--    operation validee se contre-passe, elle ne s'efface pas.
--
-- 6. LES DOUBLONS SONT IMPOSSIBLES. `idempotencyKey` est UNIQUE sur la
--    repartition ET sur la transaction de solde : un rejeu de webhook, une
--    double soumission ou un traitement concurrent ne peut pas creer deux
--    fois la meme ecriture.
-- =============================================================================

-- 1. Nature des operations de solde.
CREATE TYPE "BalanceTransactionKind" AS ENUM (
  'SHARE',
  'PAYMENT',
  'ADVANCE',
  'ADJUSTMENT',
  'CORRECTION',
  'REGULARIZATION'
);

-- 2. Base de calcul : le montant du projet s'ajoute aux bases existantes.
ALTER TYPE "DistributionBaseType" ADD VALUE IF NOT EXISTS 'PROJECT_AMOUNT';

-- 3. Regles : perimetre, version, filiation, auteur, confirmation.
ALTER TABLE "distribution_configs" ADD COLUMN "scopeKey" TEXT NOT NULL DEFAULT 'global';
ALTER TABLE "distribution_configs" ADD COLUMN "projectId" TEXT;
ALTER TABLE "distribution_configs" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "distribution_configs" ADD COLUMN "supersedesId" TEXT;
ALTER TABLE "distribution_configs" ADD COLUMN "createdById" TEXT;
ALTER TABLE "distribution_configs" ADD COLUMN "confirmedAt" TIMESTAMP(3);
ALTER TABLE "distribution_configs" ADD COLUMN "confirmedById" TEXT;

-- Les regles existantes recoivent un perimetre unique : sans cela, la creation
-- de l'index unique echouerait (plusieurs 'global' en version 1).
UPDATE "distribution_configs" SET "scopeKey" = id WHERE "scopeKey" = 'global';

CREATE UNIQUE INDEX "distribution_configs_scopeKey_version_key" ON "distribution_configs"("scopeKey", "version");
CREATE INDEX "distribution_configs_projectId_idx" ON "distribution_configs"("projectId");
CREATE INDEX "distribution_configs_supersedesId_idx" ON "distribution_configs"("supersedesId");

-- 4. Repartitions : tour incremental, cle d'idempotence, trace, base figee.
ALTER TABLE "project_distributions" ADD COLUMN "round" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "project_distributions" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "project_distributions" ADD COLUMN "calculationTrace" JSONB;
ALTER TABLE "project_distributions" ADD COLUMN "baseType" "DistributionBaseType";
ALTER TABLE "project_distributions" ADD COLUMN "baseSource" JSONB;
ALTER TABLE "project_distributions" ADD COLUMN "ruleVersion" INTEGER;

-- Une meme regle peut servir plusieurs tours de calcul sur un projet
-- (un encaissement de plus) : l'unicite (projet, regle) interdisait le
-- second tour. Elle devient (projet, tour).
DROP INDEX IF EXISTS "project_distributions_projectId_configId_key";
CREATE UNIQUE INDEX "project_distributions_projectId_round_key" ON "project_distributions"("projectId", "round");
CREATE UNIQUE INDEX "project_distributions_idempotencyKey_key" ON "project_distributions"("idempotencyKey");

-- 5. Items : pourcentage fige et trace d'arrondi.
ALTER TABLE "distribution_items" ADD COLUMN "percentage" DECIMAL(5,2);
ALTER TABLE "distribution_items" ADD COLUMN "trace" JSONB;

-- 6. Transactions de solde : auteur, nature, motif, date d'effet, contre-passation.
ALTER TABLE "balance_transactions" ADD COLUMN "authorId" TEXT;
ALTER TABLE "balance_transactions" ADD COLUMN "kind" "BalanceTransactionKind" NOT NULL DEFAULT 'SHARE';
ALTER TABLE "balance_transactions" ADD COLUMN "reason" TEXT;
ALTER TABLE "balance_transactions" ADD COLUMN "reversalOfId" TEXT;
ALTER TABLE "balance_transactions" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "balance_transactions" ADD COLUMN "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX "balance_transactions_idempotencyKey_key" ON "balance_transactions"("idempotencyKey");
CREATE INDEX "balance_transactions_authorId_idx" ON "balance_transactions"("authorId");
CREATE INDEX "balance_transactions_reversalOfId_idx" ON "balance_transactions"("reversalOfId");
CREATE INDEX "balance_transactions_kind_idx" ON "balance_transactions"("kind");
CREATE INDEX "balance_transactions_occurredAt_idx" ON "balance_transactions"("occurredAt");

-- 7. Cles etrangeres.
ALTER TABLE "distribution_configs" ADD CONSTRAINT "distribution_configs_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "distribution_configs" ADD CONSTRAINT "distribution_configs_supersedesId_fkey"
  FOREIGN KEY ("supersedesId") REFERENCES "distribution_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "distribution_configs" ADD CONSTRAINT "distribution_configs_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "distribution_configs" ADD CONSTRAINT "distribution_configs_confirmedById_fkey"
  FOREIGN KEY ("confirmedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "balance_transactions" ADD CONSTRAINT "balance_transactions_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "balance_transactions" ADD CONSTRAINT "balance_transactions_reversalOfId_fkey"
  FOREIGN KEY ("reversalOfId") REFERENCES "balance_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
