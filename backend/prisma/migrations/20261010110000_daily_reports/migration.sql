-- Récapitulatifs journaliers (un par membre et par jour). Tables en snake_case pluriel, comme le reste du schéma.
CREATE TABLE "daily_reports" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reportDate" DATE NOT NULL,
    "contentJson" JSONB NOT NULL,
    "summary" VARCHAR(280),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "daily_reports_userId_reportDate_key" ON "daily_reports"("userId", "reportDate");

CREATE INDEX "daily_reports_reportDate_idx" ON "daily_reports"("reportDate");

ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
