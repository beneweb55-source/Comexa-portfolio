-- FORMATION — etat pedagogique (progression reelle des membres).
--
-- Ces tables decrivent l'apprentissage d'un vrai membre : elles vivent en
-- PRODUCTION. Les donnees d'exercice (clients, projets, devis fictifs) sont
-- elles creees dans une base d'entrainement DISTINCTE (`TRAINING_DATABASE_URL`),
-- sur le meme schema mais un autre catalogue — aucun modele n'est declare ici
-- pour elles, et aucune de ces tables n'est touchee par une reinitialisation de
-- l'environnement de formation.

-- CreateEnum
CREATE TYPE "TrainingMissionStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "training_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "missionId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "training_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_mission_progress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "space" TEXT NOT NULL,
    "status" "TrainingMissionStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "evaluationPassed" BOOLEAN,
    "evaluationScore" INTEGER,
    "evaluationDetails" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_mission_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_attempts" (
    "id" TEXT NOT NULL,
    "progressId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "assistanceLevel" TEXT NOT NULL DEFAULT 'full',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "success" BOOLEAN,
    "errors" JSONB,

    CONSTRAINT "training_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "training_sessions_userId_startedAt_idx" ON "training_sessions"("userId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "training_mission_progress_userId_missionId_key" ON "training_mission_progress"("userId", "missionId");

-- CreateIndex
CREATE INDEX "training_mission_progress_userId_status_idx" ON "training_mission_progress"("userId", "status");

-- CreateIndex
CREATE INDEX "training_attempts_progressId_idx" ON "training_attempts"("progressId");

-- CreateIndex
CREATE INDEX "training_attempts_userId_missionId_idx" ON "training_attempts"("userId", "missionId");

-- AddForeignKey
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_mission_progress" ADD CONSTRAINT "training_mission_progress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_attempts" ADD CONSTRAINT "training_attempts_progressId_fkey" FOREIGN KEY ("progressId") REFERENCES "training_mission_progress"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_attempts" ADD CONSTRAINT "training_attempts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
