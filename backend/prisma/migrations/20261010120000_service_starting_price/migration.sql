-- Prix de depart facultatif des services (saisi dans l'admin, jamais seede).
ALTER TABLE "services"
  ADD COLUMN "startingPrice" DECIMAL(12,2),
  ADD COLUMN "startingPriceCurrency" VARCHAR(3);
