-- =============================================================================
-- DEVISE PAR DÉFAUT DES SUPPLÉMENTS DE MODIFICATION — DA, PAS EUR.
--
-- Le schéma déclare `@default("DZD")` pour les devis, factures, paiements,
-- projets et clients, mais `modification_requests.extraCostCurrency` était
-- resté sur 'EUR' — reliquat du marché de démonstration de l'init. Un
-- supplément décidé sans devise explicite s'enregistrait donc en euros, alors
-- que toutes les autres pièces de l'agence sont en dinars.
--
-- SEUL LE DÉFAUT CHANGE. Une demande déjà décidée en euros reste en euros :
-- réécrire des montants déjà communiqués au client serait une correction
-- comptable, pas une migration de schéma.
--
-- Idempotent : `SET DEFAULT` peut être rejoué sans effet de bord.
-- =============================================================================

ALTER TABLE "modification_requests" ALTER COLUMN "extraCostCurrency" SET DEFAULT 'DZD';
