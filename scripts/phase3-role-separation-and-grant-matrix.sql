-- =============================================================================
-- Knowletive Phase 3: Runtime Database Role Separation & Least-Privilege Grants
-- File: scripts/phase3-role-separation-and-grant-matrix.sql
-- =============================================================================

-- 1. Ensure runtime non-superuser role knowletive_app exists with strict attributes
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'knowletive_app') THEN
    CREATE ROLE knowletive_app WITH LOGIN PASSWORD 'knowletive_app_secure_pass';
  END IF;
  
  -- Guarantee non-superuser and no-bypass-rls attributes
  ALTER ROLE knowletive_app NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
END $$;

-- 2. Schema-Level Privileges
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM knowletive_app;
GRANT USAGE ON SCHEMA public TO knowletive_app;

-- 3. Base Table Grants: Operational Entities (CRUD)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO knowletive_app;

-- 4. Enforce Append-Only Immutability on Audit & Event Ledgers (NO UPDATE / NO DELETE)
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE
  "AuditLog",
  "BatchEnrollmentEvent",
  "ExamMarksRevisionEvent",
  "SyllabusProgressEvent",
  "CreditTransferApprovalEvent",
  "CreditTransferJournal",
  "GuardianConsentEvent",
  "LeadActivity",
  "NotificationLog",
  "BranchReconciliationAudit"
FROM knowletive_app;

-- 5. Enforce Read-Only on System Reference Data
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE "Plan" FROM knowletive_app;

-- 6. Enforce Total Isolation on Internal Migration State
REVOKE ALL ON TABLE "_prisma_migrations" FROM knowletive_app;

-- 7. Grant View Access (Defined with security_invoker = true)
GRANT SELECT ON TABLE 
  "v_effective_fee_payment",
  "v_effective_payment_receipt",
  "v_effective_payment_allocation"
TO knowletive_app;

-- 8. Sequence Grants
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO knowletive_app;

-- 9. Function Execution Grants
GRANT EXECUTE ON FUNCTION public.fn_get_effective_branch_id(text, text, text, text) TO knowletive_app;

-- 10. Security-Definer Session Context Functions
CREATE OR REPLACE FUNCTION public.fn_set_tenant_context(
  p_tenant_id TEXT,
  p_user_id TEXT,
  p_branch_ids TEXT DEFAULT '',
  p_is_tenant_wide BOOLEAN DEFAULT FALSE,
  p_is_platform_admin BOOLEAN DEFAULT FALSE,
  p_user_role TEXT DEFAULT 'STAFF',
  p_student_ids TEXT DEFAULT ''
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- 1. Validate Active Tenant
  IF p_tenant_id IS NOT NULL AND p_tenant_id <> '' THEN
    IF NOT EXISTS (SELECT 1 FROM public."Tenant" WHERE id = p_tenant_id AND status = 'ACTIVE') THEN
      RAISE EXCEPTION 'Security Violation: Tenant % does not exist or is not active.', p_tenant_id 
        USING ERRCODE = '28000';
    END IF;
  END IF;

  -- 2. Anti-Tamper Elevation Guard for Platform Admin
  -- If platform admin authority is claimed, verify that p_user_id is genuinely a platform user
  IF p_is_platform_admin THEN
    IF p_user_id IS NULL OR p_user_id = '' OR NOT EXISTS (
      SELECT 1 
      FROM public."User" u
      JOIN public."Membership" m ON m."userId" = u.id
      JOIN public."Role" r ON m."roleId" = r.id
      WHERE u.id = p_user_id 
        AND u.status = 'ACTIVE'
        AND (r.key = 'PLATFORM_OWNER' OR r.scope = 'PLATFORM')
    ) THEN
      RAISE EXCEPTION 'Security Violation: User % is not authorized for platform administration.', p_user_id 
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 3. Anti-Tamper Elevation Guard for Tenant-Wide Authority
  IF p_is_tenant_wide AND NOT p_is_platform_admin THEN
    IF NOT EXISTS (
      SELECT 1 
      FROM public."Membership" m
      JOIN public."Role" r ON m."roleId" = r.id
      WHERE m."tenantId" = p_tenant_id 
        AND m."userId" = p_user_id 
        AND m.status = 'ACTIVE'
        AND (m."isOwner" = true OR r.key = 'INSTITUTE_ADMIN' OR EXISTS (
          SELECT 1 FROM public."RolePermission" rp
          JOIN public."Permission" p ON rp."permissionId" = p.id
          WHERE rp."roleId" = r.id AND p.key = 'tenant.settings.manage'
        ))
    ) THEN
      RAISE EXCEPTION 'Security Violation: User % lacks verified tenant-wide authority in tenant %.', p_user_id, p_tenant_id 
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 4. Apply Transaction-Local Settings (is_local = true)
  PERFORM set_config('app.current_tenant_id', COALESCE(p_tenant_id, ''), true);
  PERFORM set_config('app.current_user_id', COALESCE(p_user_id, ''), true);
  PERFORM set_config('app.current_branch_ids', COALESCE(p_branch_ids, ''), true);
  PERFORM set_config('app.is_tenant_wide', CASE WHEN p_is_tenant_wide THEN 'true' ELSE 'false' END, true);
  PERFORM set_config('app.is_platform_admin', CASE WHEN p_is_platform_admin THEN 'true' ELSE 'false' END, true);
  PERFORM set_config('app.user_role', COALESCE(p_user_role, 'STAFF'), true);
  PERFORM set_config('app.current_student_ids', COALESCE(p_student_ids, ''), true);
  PERFORM set_config('app.context_initialized', 'true', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_set_tenant_context(text, text, text, boolean, boolean, text, text) TO knowletive_app;

-- 11. Clear Session Context Function
CREATE OR REPLACE FUNCTION public.fn_clear_tenant_context() RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM set_config('app.current_tenant_id', '', true);
  PERFORM set_config('app.current_user_id', '', true);
  PERFORM set_config('app.current_branch_ids', '', true);
  PERFORM set_config('app.is_tenant_wide', 'false', true);
  PERFORM set_config('app.is_platform_admin', 'false', true);
  PERFORM set_config('app.user_role', '', true);
  PERFORM set_config('app.current_student_ids', '', true);
  PERFORM set_config('app.context_initialized', 'false', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_clear_tenant_context() TO knowletive_app;

-- 12. Default Privileges for Migration Invariance
ALTER DEFAULT PRIVILEGES FOR ROLE knowletive IN SCHEMA public 
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO knowletive_app;

ALTER DEFAULT PRIVILEGES FOR ROLE knowletive IN SCHEMA public 
  GRANT USAGE, SELECT ON SEQUENCES TO knowletive_app;

ALTER DEFAULT PRIVILEGES FOR ROLE knowletive IN SCHEMA public 
  GRANT EXECUTE ON FUNCTIONS TO knowletive_app;
