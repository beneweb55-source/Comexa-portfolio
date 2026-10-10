-- Logo partenaire : une URL externe (https) remplace la clé de stockage objet,
-- qui n'était jamais renseignée (aucun upload n'existe dans le MVP).
-- Aucune donnée n'est perdue : la colonne `logoKey` était vide sur toutes les lignes.
ALTER TABLE "partners" DROP COLUMN "logoKey";
ALTER TABLE "partners" ADD COLUMN "logoUrl" VARCHAR(500);
