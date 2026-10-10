-- Demandes de projet : enregistrees quand une commande en ligne n'est pas possible.

-- CreateEnum
CREATE TYPE "ProjectRequestStatus" AS ENUM ('NEW', 'IN_REVIEW', 'CONVERTED', 'CLOSED');

-- CreateTable
CREATE TABLE "project_requests" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "packageId" TEXT,
    "country" VARCHAR(2),
    "reason" VARCHAR(40) NOT NULL,
    "message" VARCHAR(2000),
    "status" "ProjectRequestStatus" NOT NULL DEFAULT 'NEW',
    "teamNote" VARCHAR(2000),
    "handledById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_requests_reference_key" ON "project_requests"("reference");
CREATE INDEX "project_requests_userId_idx" ON "project_requests"("userId");
CREATE INDEX "project_requests_packageId_idx" ON "project_requests"("packageId");
CREATE INDEX "project_requests_status_idx" ON "project_requests"("status");
CREATE INDEX "project_requests_handledById_idx" ON "project_requests"("handledById");

-- AddForeignKey
ALTER TABLE "project_requests" ADD CONSTRAINT "project_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_requests" ADD CONSTRAINT "project_requests_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "project_requests" ADD CONSTRAINT "project_requests_handledById_fkey" FOREIGN KEY ("handledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
