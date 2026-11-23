-- 6. Verify exploit is neutralized while temporary table is still present
DO $$
DECLARE
  v_blocked BOOLEAN := FALSE;
BEGIN
  RAISE NOTICE '4. Verifying hardened function blocks exploit with temp table still present...';
  -- Attempting another reassignment with temp table present:
  BEGIN
    UPDATE "FeeInvoice" SET "studentId" = 'stu_sqla1_exp' WHERE id = 'inv_sqla_exp';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%Cannot reassign FeeInvoice.studentId%' OR SQLSTATE = 'P0001' THEN
      v_blocked := TRUE;
    END IF;
  END;

  IF NOT v_blocked THEN
    RAISE EXCEPTION 'FAIL: Hardened function failed to block exploit!';
  END IF;
  RAISE NOTICE '  ✓ PASS: Hardened function resolved public.PaymentAllocation and blocked reassignment (SQLSTATE P0001)';
END $$;
