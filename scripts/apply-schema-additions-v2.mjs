#!/usr/bin/env node

/**
 * Script pour intégrer les additions financières au schema Prisma
 * Version 2 - avec corrections pour les modèles existants
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const SCHEMA_PATH = join(PROJECT_ROOT, 'backend/prisma/schema.prisma');
const ADDITIONS_DIR = join(PROJECT_ROOT, 'backend/prisma/additions');

// Lire les fichiers
const existingSchema = readFileSync(SCHEMA_PATH, 'utf-8');
const financialModels = readFileSync(join(ADDITIONS_DIR, 'financial-foundation.prisma'), 'utf-8');

console.log('📖 Lecture des fichiers...');

// ============================================================================
// ÉTAPE 1: Ajouter les nouvelles énumérations
// ============================================================================

const enumEndMarker = '// =============================================================================\n// IDENTITE, ROLES ET PERMISSIONS\n// =============================================================================';
const enumEndIndex = existingSchema.indexOf(enumEndMarker);

if (enumEndIndex === -1) {
  console.error('❌ Impossible de trouver la fin de la section ENUMERATIONS');
  process.exit(1);
}

// Extraire les nouvelles énumérations
const newEnumsStart = financialModels.indexOf('// =============================================================================');
const newEnumsEnd = financialModels.indexOf('// =============================================================================\n// NOUVEAUX MODÈLES');
const newEnums = financialModels.slice(newEnumsStart, newEnumsEnd).trim() + '\n\n';

// Insérer les nouvelles énumérations
let modifiedSchema = existingSchema.slice(0, enumEndIndex) + newEnums + existingSchema.slice(enumEndIndex);

console.log('✅ Énumérations ajoutées');

// ============================================================================
// ÉTAPE 2: Ajouter les nouveaux modèles
// ============================================================================

const dailyReportMarker = 'model DailyReport {';
const dailyReportIndex = modifiedSchema.indexOf(dailyReportMarker);

if (dailyReportIndex === -1) {
  console.error('❌ Impossible de trouver DailyReport');
  process.exit(1);
}

const newModelsStart = financialModels.indexOf('// =============================================================================\n// NOUVEAUX MODÈLES');
const newModels = financialModels.slice(newModelsStart).trim() + '\n\n';

modifiedSchema = modifiedSchema.slice(0, dailyReportIndex) + newModels + modifiedSchema.slice(dailyReportIndex);

console.log('✅ Nouveaux modèles ajoutés');

// ============================================================================
// ÉTAPE 3: Modifier les modèles existants
// ============================================================================

// 1. Modifier User
const userModification = `
  /// Devise préférée pour l'affichage (ne modifie pas les données financières)
  preferredCurrency String?    @db.VarChar(3)

  // Relations inverses pour les soldes
  balances BalanceTransaction[] @relation("UserBalanceTransactions")
  memberBalances MemberBalance[]`;

const userEndMarker = '  roles                   UserRole[]';
const userEndIndex = modifiedSchema.indexOf(userEndMarker);

if (userEndIndex === -1) {
  console.error('❌ Impossible de trouver la fin de User');
  process.exit(1);
}

modifiedSchema = modifiedSchema.slice(0, userEndIndex) + userModification + '\n' + modifiedSchema.slice(userEndIndex);
console.log('✅ User modifié');

// 2. Modifier Client
const clientModification = `
  /// Devise par défaut pour ce client (DZD ou EUR)
  /// À l'avenir, le client choisira entre DZD et EUR
  currency String @default("DZD")

  /// Lien vers Currency (optionnel, pour navigation)
  currencyId String?
  currencyObj Currency? @relation(fields: [currencyId], references: [id], onDelete: SetNull)`;

const clientCountryMarker = '  country      String?\n\n  status ClientStatus @default(ACTIVE)';
const clientCountryIndex = modifiedSchema.indexOf(clientCountryMarker);

if (clientCountryIndex === -1) {
  console.error('❌ Impossible de trouver country dans Client');
  process.exit(1);
}

const newClientSection = `  country      String?
${clientModification}

  status ClientStatus @default(ACTIVE)`;
modifiedSchema = modifiedSchema.replace(clientCountryMarker, newClientSection);
console.log('✅ Client modifié');

// 3. Modifier Project
const projectModification = `
  /// Devise du projet - SOURCE DE VÉRITÉ
  /// Par défaut: DZD (marché principal = Algérie)
  /// Ne JAMAIS modifier les projets existants sans validation
  currency String @default("DZD")

  /// Lien vers Currency (optionnel, pour navigation)
  currencyId String?
  currencyObj Currency? @relation(fields: [currencyId], references: [id], onDelete: SetNull)

  /// Répartitions des gains pour ce projet
  distributions ProjectDistribution[]`;

const projectBudgetMarker = '  budget   Decimal? @db.Decimal(14, 2)\n  currency String   @default("EUR")';
const projectBudgetIndex = modifiedSchema.indexOf(projectBudgetMarker);

if (projectBudgetIndex === -1) {
  console.error('❌ Impossible de trouver budget dans Project');
  process.exit(1);
}

const newProjectSection = `  budget   Decimal? @db.Decimal(14, 2)
${projectModification}`;
modifiedSchema = modifiedSchema.replace(projectBudgetMarker, newProjectSection);
console.log('✅ Project modifié');

// 4. Modifier Quote
const quoteModification = `
  /// Devise du devis - SOURCE DE VÉRITÉ
  currency String @default("DZD")

  /// Lien vers Currency (optionnel, pour navigation)
  currencyId String?
  currencyObj Currency? @relation(fields: [currencyId], references: [id], onDelete: SetNull)`;

const quoteCurrencyMarker = '  validUntil DateTime?\n\n  currency       String  @default("EUR")';
const quoteCurrencyIndex = modifiedSchema.indexOf(quoteCurrencyMarker);

if (quoteCurrencyIndex === -1) {
  console.error('❌ Impossible de trouver currency dans Quote');
  process.exit(1);
}

const newQuoteSection = `  validUntil DateTime?
${quoteModification}`;
modifiedSchema = modifiedSchema.replace(quoteCurrencyMarker, newQuoteSection);
console.log('✅ Quote modifié');

// 5. Modifier Invoice - CORRECTION: currency est sur la même ligne
const invoiceModification = `
  /// Devise de la facture - SOURCE DE VÉRITÉ
  currency String @default("DZD")

  /// Lien vers Currency (optionnel, pour navigation)
  currencyId String?
  currencyObj Currency? @relation(fields: [currencyId], references: [id], onDelete: SetNull)`;

// Dans Invoice, currency est sur la même ligne que les autres champs
const invoiceCurrencyMarker = '  paidAt    DateTime?\n\n  currency       String  @default("EUR")';
const invoiceCurrencyIndex = modifiedSchema.indexOf(invoiceCurrencyMarker);

if (invoiceCurrencyIndex === -1) {
  console.error('❌ Impossible de trouver paidAt/currency dans Invoice');
  process.exit(1);
}

const newInvoiceSection = `  paidAt    DateTime?
${invoiceModification}`;
modifiedSchema = modifiedSchema.replace(invoiceCurrencyMarker, newInvoiceSection);
console.log('✅ Invoice modifié');

// 6. Modifier Payment
const paymentModification = `
  /// Devise du paiement - SOURCE DE VÉRITÉ
  currency String @default("DZD")

  /// Lien vers Currency (optionnel, pour navigation)
  currencyId String?
  currencyObj Currency? @relation(fields: [currencyId], references: [id], onDelete: SetNull)

  /// Transactions de solde liées à ce paiement
  balanceTransactions BalanceTransaction[] @relation("PaymentBalanceTransactions")`;

const paymentCurrencyMarker = '  paidAt            DateTime\n\n  /// Reference externe (virement, transaction) et justificatif eventuel.\n  externalReference String?';
const paymentCurrencyIndex = modifiedSchema.indexOf(paymentCurrencyMarker);

if (paymentCurrencyIndex === -1) {
  console.error('❌ Impossible de trouver paidAt dans Payment');
  process.exit(1);
}

const newPaymentSection = `  paidAt            DateTime
${paymentModification}

  /// Reference externe (virement, transaction) et justificatif eventuel.`;
modifiedSchema = modifiedSchema.replace(paymentCurrencyMarker, newPaymentSection);
console.log('✅ Payment modifié');

// 7. Modifier Conversation
const conversationModification = `
  /// Est-ce un groupe ?
  isGroup Boolean @default(false)
  /// Nom du groupe (si isGroup = true)
  groupName String?
  /// Description du groupe
  groupDescription String?

  /// Ressources partagées dans cette conversation
  sharedResources MessageResource[]`;

const conversationMarker = '  lastMessagePreview String?\n\n  isArchived         Boolean   @default(false)';
const conversationIndex = modifiedSchema.indexOf(conversationMarker);

if (conversationIndex === -1) {
  console.error('❌ Impossible de trouver lastMessagePreview dans Conversation');
  process.exit(1);
}

const newConversationSection = `  lastMessagePreview String?
${conversationModification}

  isArchived         Boolean   @default(false)`;
modifiedSchema = modifiedSchema.replace(conversationMarker, newConversationSection);
console.log('✅ Conversation modifié');

// 8. Modifier Message
const messageModification = `
  /// Statut de livraison par défaut (SENT)
  deliveryStatus MessageDeliveryStatus @default(SENT)

  /// Ressources partagées dans ce message
  sharedResources MessageResource[]`;

const messageMarker = '  deletedAt DateTime?\n\n  attachments MessageAttachment[]';
const messageIndex = modifiedSchema.indexOf(messageMarker);

if (messageIndex === -1) {
  console.error('❌ Impossible de trouver deletedAt dans Message');
  process.exit(1);
}

const newMessageSection = `  deletedAt DateTime?
${messageModification}

  attachments MessageAttachment[]`;
modifiedSchema = modifiedSchema.replace(messageMarker, newMessageSection);
console.log('✅ Message modifié');

// 9. Modifier PackageRate (optionnel)
const packageRateModification = `
  /// Lien vers Currency (optionnel, pour navigation)
  currencyId String?
  currencyObj Currency? @relation(fields: [currencyId], references: [id], onDelete: SetNull)`;

const packageRateMarker = '  currency      String        @db.VarChar(3)\n\n  effectiveFrom  DateTime';
const packageRateIndex = modifiedSchema.indexOf(packageRateMarker);

if (packageRateIndex !== -1) {
  const newPackageRateSection = `  currency      String        @db.VarChar(3)
${packageRateModification}

  effectiveFrom  DateTime`;
  modifiedSchema = modifiedSchema.replace(packageRateMarker, newPackageRateSection);
  console.log('✅ PackageRate modifié');
}

// ============================================================================
// ÉTAPE 4: Écrire le fichier final
// ============================================================================

const outputPath = join(PROJECT_ROOT, 'backend/prisma/schema.prisma.new');
writeFileSync(outputPath, modifiedSchema, 'utf-8');

console.log('\n✅ Fichier généré: backend/prisma/schema.prisma.new');
console.log('\n📝 Prochaines étapes:');
console.log('1. Vérifier le fichier: npx prisma validate --schema=backend/prisma/schema.prisma.new');
console.log('2. Si OK, remplacer le fichier existant');
console.log('3. Générer les migrations: npx prisma migrate dev --name add_financial_foundation');
