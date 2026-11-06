-- ============================================================================
-- KNOWLETIVE SAAS — ENTERPRISE BATCH MANAGEMENT DATABASE HARDENING
-- SCRIPT: 20261106_batch_event_immutability.sql
-- PURPOSE: Guarantee database-level immutability for BatchEnrollmentEvent records
-- APPLIED ON: PostgreSQL 18.x
-- SAFETY: Idempotent (safe to re-execute). Does NOT delete or modify existing data.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Threat Model & Architectural Rationale
-- ----------------------------------------------------------------------------
-- The BatchEnrollmentEvent table acts as an append-only audit trail recording
-- student enrollments, drops, transfers, completions, and re-enrollments.
-- Application code must NEVER update, delete, or truncate records in this table.
--
-- Defense-in-depth Strategy:
--  a) Row-level trigger: Intercepts UPDATE and DELETE operations on individual rows.
--  b) Statement-level trigger: Intercepts TRUNCATE commands (which bypass row triggers).
--  c) DCL Privileges: Explicitly revokes UPDATE, DELETE, and TRUNCATE from PUBLIC.
--  d) Foreign Key: Batch and Student relations enforce ON DELETE RESTRICT in schema.
--
-- Security Limitation Note:
-- PostgreSQL table owners and superusers bypass privilege checks and can alter
-- or drop triggers if they possess direct DDL access. In production, standard
-- application connection pools should connect using a least-privilege role that
-- does not own the DDL schema or possess SUPERUSER privileges.
-- ----------------------------------------------------------------------------

-- 2. Create or Replace the Immutability Enforcement Function
CREATE OR REPLACE FUNCTION prevent_batch_event_tampering()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'BatchEnrollmentEvent records are immutable and cannot be updated, deleted, or truncated.';
END;
$$ LANGUAGE plpgsql;

-- 3. Row-Level Trigger for UPDATE and DELETE
DROP TRIGGER IF EXISTS trg_prevent_batch_event_tampering ON "BatchEnrollmentEvent";
CREATE TRIGGER trg_prevent_batch_event_tampering
BEFORE UPDATE OR DELETE ON "BatchEnrollmentEvent"
FOR EACH ROW
EXECUTE FUNCTION prevent_batch_event_tampering();

-- 4. Statement-Level Trigger for TRUNCATE
-- In PostgreSQL, row-level triggers do NOT execute upon TRUNCATE TABLE.
-- A statement-level trigger is mandatory to close the TRUNCATE gap.
DROP TRIGGER IF EXISTS trg_prevent_batch_event_truncate ON "BatchEnrollmentEvent";
CREATE TRIGGER trg_prevent_batch_event_truncate
BEFORE TRUNCATE ON "BatchEnrollmentEvent"
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_batch_event_tampering();

-- 5. Revoke Destructive Permissions from Public Role
-- Prevents ordinary non-owner roles from attempting updates/deletions even if triggers are bypassed.
REVOKE UPDATE, DELETE, TRUNCATE ON "BatchEnrollmentEvent" FROM PUBLIC;

-- 6. Verification Queries (for DBAs / Migration Runners)
-- SELECT event_object_table, trigger_name, event_manipulation, action_timing
-- FROM information_schema.triggers
-- WHERE event_object_table = 'BatchEnrollmentEvent';

