-- Taches personnelles + minuteur serveur.
--
-- 1. Une tache peut ne porter AUCUN projet : c'est une tache personnelle,
--    privee, dont le proprietaire est l'assigne. Les taches existantes ne
--    bougent pas (isPersonal = false, projectId deja renseigne).
-- 2. Une saisie de temps peut ne porter aucun projet : c'est la contrepartie
--    comptable d'une tache personnelle. Le temps reste imputable a son auteur.
-- 3. Le minuteur devient une entite serveur : une session par compte, soldee
--    en saisie de temps a l'arret.

-- AlterTable : taches personnelles
ALTER TABLE "tasks" ADD COLUMN "isPersonal" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tasks" ALTER COLUMN "projectId" DROP NOT NULL;

-- AlterTable : saisies de temps sans projet
ALTER TABLE "time_entries" ALTER COLUMN "projectId" DROP NOT NULL;

-- CreateEnum
CREATE TYPE "TimerSessionStatus" AS ENUM ('RUNNING', 'PAUSED', 'STOPPED');

-- CreateTable
CREATE TABLE "timer_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" TEXT,
    "status" "TimerSessionStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "resumedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),
    "accumulatedSeconds" INTEGER NOT NULL DEFAULT 0,
    "savedMinutes" INTEGER,
    "timeEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "timer_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "timer_sessions_userId_status_idx" ON "timer_sessions"("userId", "status");
CREATE INDEX "timer_sessions_taskId_idx" ON "timer_sessions"("taskId");
CREATE INDEX "timer_sessions_status_startedAt_idx" ON "timer_sessions"("status", "startedAt");
CREATE UNIQUE INDEX "timer_sessions_timeEntryId_key" ON "timer_sessions"("timeEntryId");

-- UNE SEULE SESSION ACTIVE PAR COMPTE. Index partiel : les lignes STOPPED ne
-- comptent pas (elles forment l'historique). Deux demarrages concurrents ne
-- peuvent pas creer deux sessions : le second echoue sur cet index, et le
-- service traduit la violation en 409 TIMER_ALREADY_ACTIVE.
CREATE UNIQUE INDEX "timer_sessions_one_active_per_user" ON "timer_sessions"("userId") WHERE "status" IN ('RUNNING', 'PAUSED');

-- AddForeignKey
ALTER TABLE "timer_sessions" ADD CONSTRAINT "timer_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "timer_sessions" ADD CONSTRAINT "timer_sessions_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "timer_sessions" ADD CONSTRAINT "timer_sessions_timeEntryId_fkey" FOREIGN KEY ("timeEntryId") REFERENCES "time_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
