CREATE TABLE "onboarding_progress" (
  "userId" TEXT NOT NULL,
  "area" TEXT NOT NULL,
  "step" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'active',
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "onboarding_progress_pkey" PRIMARY KEY ("userId", "area"),
  CONSTRAINT "onboarding_progress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
