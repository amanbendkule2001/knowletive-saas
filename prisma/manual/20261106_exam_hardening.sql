-- Stage 4: Enterprise Exam Management System Database Hardening
-- Target Integrity and Immutability Constraints

-- 1. Examination Target Integrity Check Constraint
-- Ensures CLASS_SECTION has classId and NO batchId, while BATCH has batchId and NO classId/sectionId.
ALTER TABLE "Examination" DROP CONSTRAINT IF EXISTS chk_examination_target_integrity;
ALTER TABLE "Examination" ADD CONSTRAINT chk_examination_target_integrity CHECK (
  ("targetType" = 'CLASS_SECTION' AND "classId" IS NOT NULL AND "batchId" IS NULL) OR
  ("targetType" = 'BATCH' AND "batchId" IS NOT NULL AND "classId" IS NULL AND "sectionId" IS NULL)
);

-- 2. GradeScale Non-Overlapping and Boundaries Validation Helper
-- ExamResultSnapshot Immutability
CREATE OR REPLACE FUNCTION fn_protect_exam_snapshot_immutability()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'ExamResultSnapshot records are immutable and cannot be updated or deleted (resultId: %)', OLD."resultId"
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_exam_snapshot_protect ON "ExamResultSnapshot";
CREATE TRIGGER trg_exam_snapshot_protect
BEFORE UPDATE OR DELETE ON "ExamResultSnapshot"
FOR EACH ROW
EXECUTE FUNCTION fn_protect_exam_snapshot_immutability();

CREATE OR REPLACE FUNCTION fn_protect_exam_snapshot_truncate()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'ExamResultSnapshot records are immutable and cannot be truncated'
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_exam_snapshot_truncate ON "ExamResultSnapshot";
CREATE TRIGGER trg_exam_snapshot_truncate
BEFORE TRUNCATE ON "ExamResultSnapshot"
FOR EACH STATEMENT
EXECUTE FUNCTION fn_protect_exam_snapshot_truncate();

-- 3. ExamMarksRevisionEvent Immutability
CREATE OR REPLACE FUNCTION fn_protect_exam_revision_event_immutability()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'ExamMarksRevisionEvent records are immutable audit logs and cannot be updated or deleted (id: %)', OLD.id
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_exam_revision_event_protect ON "ExamMarksRevisionEvent";
CREATE TRIGGER trg_exam_revision_event_protect
BEFORE UPDATE OR DELETE ON "ExamMarksRevisionEvent"
FOR EACH ROW
EXECUTE FUNCTION fn_protect_exam_revision_event_immutability();

CREATE OR REPLACE FUNCTION fn_protect_exam_revision_truncate()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'ExamMarksRevisionEvent records are immutable audit logs and cannot be truncated'
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_exam_revision_truncate ON "ExamMarksRevisionEvent";
CREATE TRIGGER trg_exam_revision_truncate
BEFORE TRUNCATE ON "ExamMarksRevisionEvent"
FOR EACH STATEMENT
EXECUTE FUNCTION fn_protect_exam_revision_truncate();

