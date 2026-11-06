-- ============================================================================
-- KNOWLETIVE SAAS — STAGE 3.1: SYLLABUSTRACK DATA INTEGRITY & HARDENING
-- File: prisma/manual/20261106_syllabustrack_hardening.sql
-- ============================================================================

-- 1. Harmonize existing rows with missing targets
UPDATE "public"."SyllabusTrack" st
SET "classId" = cl.id
FROM (
  SELECT DISTINCT ON ("tenantId") id, "tenantId" FROM "public"."ClassLevel" ORDER BY "tenantId", "name" ASC
) cl
WHERE st."tenantId" = cl."tenantId"
  AND st."classId" IS NULL
  AND st."batchId" IS NULL;

-- 2. Target Integrity Check Constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_syllabustrack_target_integrity'
  ) THEN
    ALTER TABLE "public"."SyllabusTrack"
      ADD CONSTRAINT "chk_syllabustrack_target_integrity"
      CHECK (
        (
          "targetType" = 'CLASS_SECTION'
          AND "classId" IS NOT NULL
          AND "batchId" IS NULL
        )
        OR
        (
          "targetType" = 'BATCH'
          AND "batchId" IS NOT NULL
          AND "classId" IS NULL
          AND "sectionId" IS NULL
        )
      );
  END IF;
END $$;

-- 3. Immutability Trigger for SyllabusProgressEvent
CREATE OR REPLACE FUNCTION trg_syllabustrack_event_immutability()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'SyllabusProgressEvent records are immutable and cannot be updated, deleted, or truncated.'
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_syllabustrack_event ON "public"."SyllabusProgressEvent";
CREATE TRIGGER trg_protect_syllabustrack_event
  BEFORE UPDATE OR DELETE ON "public"."SyllabusProgressEvent"
  FOR EACH ROW
  EXECUTE FUNCTION trg_syllabustrack_event_immutability();

DROP TRIGGER IF EXISTS trg_protect_syllabustrack_event_truncate ON "public"."SyllabusProgressEvent";
CREATE TRIGGER trg_protect_syllabustrack_event_truncate
  BEFORE TRUNCATE ON "public"."SyllabusProgressEvent"
  FOR EACH STATEMENT
  EXECUTE FUNCTION trg_syllabustrack_event_immutability();

-- 4. Role-Level Privilege Hardening
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'knowletive_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON "public"."SyllabusProgressEvent" FROM knowletive_app;
    GRANT SELECT, INSERT ON "public"."SyllabusProgressEvent" TO knowletive_app;
  END IF;
END $$;

