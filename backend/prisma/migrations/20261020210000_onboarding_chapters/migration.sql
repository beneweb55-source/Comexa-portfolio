ALTER TABLE "onboarding_progress"
  ADD COLUMN "completedChapterIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "knownChapterIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "currentChapterId" TEXT,
  ADD COLUMN "curriculumVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
-- L'ancien index d'étape n'est pas une preuve d'acquisition : ne pas le convertir
-- en chapitres terminés, tout en conservant step/status pour la reprise historique.
