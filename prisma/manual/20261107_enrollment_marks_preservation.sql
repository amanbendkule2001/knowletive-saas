-- Stage 4.3 — Step 3.2: Reversible Candidate-Level Status Propagation & Subject Mark Preservation
-- Add preservedMarks JSONB column to ExamEnrollment to store pre-override subject marks snapshot
--
-- Concurrency & Lock Characterization:
-- 1. Nullable JSONB column addition without a default avoids a full table rewrite.
-- 2. PostgreSQL still requires an ACCESS EXCLUSIVE lock for the ALTER TABLE operation.
-- 3. A bounded lock_timeout helps prevent prolonged lock queuing.
-- 4. The operation is additive and backward-compatible for the previous application version, but it is not guaranteed to be lock-free or zero-downtime.

SET lock_timeout = '3s';

ALTER TABLE "ExamEnrollment"
ADD COLUMN IF NOT EXISTS "preservedMarks" JSONB;

-- Comment describing purpose
COMMENT ON COLUMN "ExamEnrollment"."preservedMarks" IS 'Stores previous subject marks state before candidate-level ABSENT/EXEMPTED override was applied';
