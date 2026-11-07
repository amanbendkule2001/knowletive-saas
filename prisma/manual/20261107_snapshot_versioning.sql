-- Stage 4.3 — Step 1: Versioned Result Snapshots
-- 1. Add version column with default 1
ALTER TABLE "ExamResultSnapshot" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

-- 2. Drop the obsolete single-result unique constraint
ALTER TABLE "ExamResultSnapshot" DROP CONSTRAINT IF EXISTS "ExamResultSnapshot_resultId_key";

-- 3. Add compound unique constraint on (resultId, version)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ExamResultSnapshot_resultId_version_key'
  ) THEN
    ALTER TABLE "ExamResultSnapshot" ADD CONSTRAINT "ExamResultSnapshot_resultId_version_key" UNIQUE ("resultId", "version");
  END IF;
END $$;
