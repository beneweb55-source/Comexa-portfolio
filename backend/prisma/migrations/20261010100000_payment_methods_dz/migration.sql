-- Moyens de paiement algériens : CCP et BaridiMob (Algérie Poste).
-- ALTER TYPE ... ADD VALUE est transactionnel depuis PostgreSQL 12 ; pas besoin de découper.
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'CCP';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'BARIDIMOB';
