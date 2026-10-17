#!/usr/bin/env node

/**
 * Script pour intégrer les additions financières au schema Prisma
 * 
 * Ce script:
 * 1. Lit le schema existant
 * 2. Ajoute les nouvelles énumérations
 * 3. Modifie les modèles existants
 * 4. Ajoute les nouveaux modèles
 * 5. Écrit le résultat dans un nouveau fichier
 * 
 * À exécuter avec: node scripts/apply-schema-additions.mjs
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

// Trouver la fin de la section ENUMERATIONS (avant "// ==== IDENTITE ====")
const enumEndMarker = '// =============================================================================\n// IDENTITE, ROLES ET PERMISSIONS\n// =============================================================================';
const enumEndIndex = existingSchema.indexOf(enumEndMarker);

if (enumEndIndex === -1) {
  console.error('❌ Impossible de trouver la fin de la section ENUMERATIONS');
  process.exit(1);
}

// Extraire les nouvelles énumérations du fichier financialModels
const newEnumsStart = financialModels.indexOf('// =============================================================================');
const newEnumsEnd = financialModels.indexOf('// =============================================================================\n// NOUVEAUX MODÈLES');
const newEnums = financialModels.slice(newEnumsStart, newEnumsEnd).trim() + '\n\n';

// Insérer les nouvelles énumérations
let modifiedSchema = existingSchema.slice(0, enumEndIndex) + newEnums + existingSchema.slice(enumEndIndex);

console.log('✅ Énumérations ajoutées');

// ============================================================================
// ÉTAPE 2: Modifier les modèles existants
// ============================================================================

// Lire les modifications à apporter
const modifications = readFileSync(join(ADDITIONS_DIR, 'existing-models-modifications.prisma'), 'utf-8');

// Nous allons appliquer les modifications manuellement car elles sont complexes
// Pour l'instant, on va juste ajouter les nouveaux modèles à la fin

// ============================================================================
// ÉTAPE 3: Ajouter les nouveaux modèles
// ============================================================================

// Trouver la fin du fichier (avant le dernier modèle DailyReport)
const dailyReportMarker = 'model DailyReport {';
const dailyReportIndex = modifiedSchema.indexOf(dailyReportMarker);

if (dailyReportIndex === -1) {
  console.error('❌ Impossible de trouver DailyReport');
  process.exit(1);
}

// Extraire les nouveaux modèles (après les énumérations)
const newModelsStart = financialModels.indexOf('// =============================================================================\n// NOUVEAUX MODÈLES');
const newModels = financialModels.slice(newModelsStart).trim() + '\n\n';

// Insérer les nouveaux modèles avant DailyReport
modifiedSchema = modifiedSchema.slice(0, dailyReportIndex) + newModels + modifiedSchema.slice(dailyReportIndex);

console.log('✅ Nouveaux modèles ajoutés');

// ============================================================================
// ÉTAPE 4: Modifier les modèles existants
// ============================================================================

// Nous allons utiliser des remplacements de chaînes pour modifier les modèles existants

// 1. Modifier User
const userModification = `
  /// Devise préférée pour l'affichage (ne modifie pas les données financières)
  preferredCurrency String?    @db.VarChar(3)

  // Relations inverses pour les soldes
  balances BalanceTransaction[] @relation("UserBalanceTransactions")
  memberBalances MemberBalance[]`;

// Trouver la fin de User (avant la relation UserRole)
const userEndMarker = '  roles                   UserRole[]';
const userEndIndex = modifiedSchema.indexOf(userEndMarker);

if (userEndIndex === -1) {
  console.error('❌ Impossible de trouver la fin de User');
  process.exit(1);
}

// Insérer avant UserRole
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

// Trouver dans Client (après le champ country)
const clientCountryMarker = '  country      String?\n\n  status ClientStatus @default(ACTIVE)';
const clientCountryIndex = modifiedSchema.indexOf(clientCountryMarker);

if (clientCountryIndex === -1) {
  console.error('❌ Impossible de trouver country dans Client');
  process.exit(1);
}

// Remplacer le marker par le marker + les nouveaux champs
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

// Trouver dans Project (après le champ budget)
const projectBudgetMarker = '  budget   Decimal? @db.Decimal(14, 2)\n  currency String   @default("EUR")';
const projectBudgetIndex = modifiedSchema.indexOf(projectBudgetMarker);

if (projectBudgetIndex === -1) {
  console.error('❌ Impossible de trouver budget dans Project');
  process.exit(1);
}

// Remplacer l'ancien currency par le nouveau
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

// Trouver dans Quote (après le champ validUntil)
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

// 5. Modifier Invoice
const invoiceModification = `
  /// Devise de la facture - SOURCE DE VÉRITÉ
  currency String @default("DZD")

  /// Lien vers Currency (optionnel, pour navigation)
  currencyId String?
  currencyObj Currency? @relation(fields: [currencyId], references: [id], onDelete: SetNull)`;

// Trouver dans Invoice (après le champ dueDate)
const invoiceCurrencyMarker = '  dueDate   DateTime\n\n  currency       String  @default("EUR")';
const invoiceCurrencyIndex = modifiedSchema.indexOf(invoiceCurrencyMarker);

if (invoiceCurrencyIndex === -1) {
  console.error('❌ Impossible de trouver currency dans Invoice');
  process.exit(1);
}

const newInvoiceSection = `  dueDate   DateTime
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

// Trouver dans Payment (après le champ amount)
const paymentCurrencyMarker = '  amount   Decimal       @db.Decimal(14, 2)\n  currency String        @default("EUR")';
const paymentCurrencyIndex = modifiedSchema.indexOf(paymentCurrencyMarker);

if (paymentCurrencyIndex === -1) {
  console.error('❌ Impossible de trouver currency dans Payment');
  process.exit(1);
}

const newPaymentSection = `  amount   Decimal       @db.Decimal(14, 2)
${paymentModification}`;
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

// Trouver dans Conversation (après le champ lastMessagePreview)
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

// Trouver dans Message (après le champ deletedAt)
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

// 9. Modifier PackageRate
const packageRateModification = `
  /// Lien vers Currency (optionnel, pour navigation)
  currencyId String?
  currencyObj Currency? @relation(fields: [currencyId], references: [id], onDelete: SetNull)`;

// Trouver dans PackageRate (après le champ currency)
const packageRateMarker = '  currency      String        @db.VarChar(3)\n\n  effectiveFrom  DateTime';
const packageRateIndex = modifiedSchema.indexOf(packageRateMarker);

if (packageRateIndex === -1) {
  console.error('⚠️ Impossible de trouver currency dans PackageRate (optionnel)');
  // Ce n'est pas bloquant, on continue
} else {
  const newPackageRateSection = `  currency      String        @db.VarChar(3)
${packageRateModification}

  effectiveFrom  DateTime`;
  modifiedSchema = modifiedSchema.replace(packageRateMarker, newPackageRateSection);
  console.log('✅ PackageRate modifié');
}

// ============================================================================
// ÉTAPE 5: Écrire le fichier final
// ============================================================================

const outputPath = join(PROJECT_ROOT, 'backend/prisma/schema.prisma.new');
writeFileSync(outputPath, modifiedSchema, 'utf-8');

console.log('\n✅ Fichier généré: backend/prisma/schema.prisma.new');
console.log('\n📝 Prochaines étapes:');
console.log('1. Vérifier le fichier: npx prisma validate --schema=backend/prisma/schema.prisma.new');
console.log('2. Si OK, remplacer le fichier existant');
console.log('3. Générer les migrations: npx prisma migrate dev --name add_financial_foundation');
