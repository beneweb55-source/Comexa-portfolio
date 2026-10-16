-- Objectifs personnels et note du minuteur.
--
-- MIGRATION PUREMENT ADDITIVE : deux tables nouvelles, une colonne nullable.
-- Aucune donnee existante n'est modifiee ni deplacee, et la table `tasks`
-- n'est PAS touchee — le rattachement d'une tache a un objectif vit dans
-- `goal_tasks`, une table de liaison privee a son proprietaire.

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('ACTIVE', 'ACHIEVED', 'ARCHIVED');

-- AlterTable : note libre de la session de minuteur (description de la saisie a l'arret).
ALTER TABLE "timer_sessions" ADD COLUMN "note" TEXT;

-- CreateTable
CREATE TABLE "goals" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "targetDate" TIMESTAMP(3),
    "color" TEXT NOT NULL DEFAULT 'blue',
    "status" "GoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "achievedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_tasks" (
    "goalId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goal_tasks_pkey" PRIMARY KEY ("goalId","taskId")
);

-- CreateIndex
CREATE INDEX "goals_ownerId_status_idx" ON "goals"("ownerId", "status");

-- CreateIndex
CREATE INDEX "goal_tasks_taskId_idx" ON "goal_tasks"("taskId");

-- CreateIndex : une tache sert au plus un objectif par personne.
CREATE UNIQUE INDEX "goal_tasks_ownerId_taskId_key" ON "goal_tasks"("ownerId", "taskId");

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_tasks" ADD CONSTRAINT "goal_tasks_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_tasks" ADD CONSTRAINT "goal_tasks_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_tasks" ADD CONSTRAINT "goal_tasks_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
