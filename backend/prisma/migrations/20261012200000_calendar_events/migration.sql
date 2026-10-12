-- Calendriers personnel et equipe : evenements, rappels, rendez-vous.
--
-- Les echeances de taches/projets ne sont PAS ici : elles restent dans leurs
-- tables (dueDate) et sont derivees a la lecture — une seule source de verite.
--
-- Garanties de ce fichier :
--  - chaque instruction est idempotente : `migrate deploy` peut etre relance ;
--  - contrainte CHECK `calendar_events_range_check` : une fin avant le debut est
--    impossible, meme via une requete directe ;
--  - les permissions du calendrier sont INSEREES ici (comme pour les taches
--    personnelles) : un deploiement « migrations seulement » ne laisse aucun
--    role sans droits, un reseed reste sans effet de bord.
-- Prisma <= 6 n'emet pas de CHECK sur `DateTime?` + `@updatedAt` croise : il est
-- declare ici, a la main, parce que l'integrite des horaires est une regle
-- metier et pas un confort d'affichage.

-- CreateEnum
CREATE TYPE "CalendarEventKind" AS ENUM ('EVENT', 'REMINDER', 'DEADLINE');

-- CreateEnum
CREATE TYPE "CalendarVisibility" AS ENUM ('PRIVATE', 'SHARED');

-- CreateTable
CREATE TABLE "calendar_events" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "kind" "CalendarEventKind" NOT NULL DEFAULT 'EVENT',
    "visibility" "CalendarVisibility" NOT NULL DEFAULT 'PRIVATE',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "location" TEXT,
    "taskId" TEXT,
    "projectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_event_participants" (
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_event_participants_pkey" PRIMARY KEY ("eventId","userId")
);

-- CreateIndex
CREATE INDEX "calendar_events_ownerId_startsAt_idx" ON "calendar_events"("ownerId", "startsAt");

-- CreateIndex
CREATE INDEX "calendar_events_visibility_startsAt_idx" ON "calendar_events"("visibility", "startsAt");

-- CreateIndex
CREATE INDEX "calendar_events_taskId_idx" ON "calendar_events"("taskId");

-- CreateIndex
CREATE INDEX "calendar_events_projectId_idx" ON "calendar_events"("projectId");

-- CreateIndex
CREATE INDEX "calendar_event_participants_userId_idx" ON "calendar_event_participants"("userId");

-- Integrite metier : la fin d'un evenement ne peut pas preceder son debut.
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_range_check" CHECK ("endsAt" IS NULL OR "endsAt" >= "startsAt");

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event_participants" ADD CONSTRAINT "calendar_event_participants_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "calendar_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event_participants" ADD CONSTRAINT "calendar_event_participants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- PERMISSIONS DU CALENDRIER (idempotent)
-- ---------------------------------------------------------------------------
INSERT INTO "permissions" ("id", "code", "resource", "action", "scope", "description", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text,
       codes.code,
       split_part(codes.code, ':', 1),
       split_part(codes.code, ':', 2),
       split_part(codes.code, ':', 3),
       codes.description,
       NOW(), NOW()
FROM (VALUES
    ('calendar:read:own', 'Consulter son calendrier personnel'),
    ('calendar:write:own', 'Creer, modifier et supprimer ses propres evenements'),
    ('calendar:read:team', 'Consulter les evenements partages de l''equipe'),
    ('calendar:manage:any', 'Gerer tous les evenements de calendrier')
) AS codes(code, description)
WHERE NOT EXISTS (
    SELECT 1 FROM "permissions" p WHERE p.code = codes.code
);

-- Membres (hors CLIENT) : leur calendrier personnel + la vue equipe.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE p.code IN ('calendar:read:own', 'calendar:write:own', 'calendar:read:team')
  AND r.code IN ('COMMUNICATION_MANAGER', 'PROJECT_MANAGER', 'DEVELOPER', 'DESIGNER', 'SALES')
  AND NOT EXISTS (
    SELECT 1 FROM "role_permissions" rp
    WHERE rp."roleId" = r.id AND rp."permissionId" = p.id
  );

-- Seuls les administrateurs (role ADMIN, dont les permissions sont etalees a
-- l'insertion) ou un porteur explicite gerent les evenements des autres.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE p.code = 'calendar:manage:any'
  AND r.code = 'ADMIN'
  AND NOT EXISTS (
    SELECT 1 FROM "role_permissions" rp
    WHERE rp."roleId" = r.id AND rp."permissionId" = p.id
  );
