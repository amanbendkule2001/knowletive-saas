-- Stage 1.5: Financial Reversal Transaction Isolation Hardening
-- Enforces Option A: Restrict reversal writes to READ COMMITTED.
-- Prevents snapshot isolation write-skew anomalies under REPEATABLE READ and SERIALIZABLE.

CREATE OR REPLACE FUNCTION fn_enforce_allocation_reversal_limit()
RETURNS TRIGGER AS $$
DECLARE
    v_allocation_amount INTEGER;
    v_current_reversal_sum INTEGER;
    v_isolation TEXT;
BEGIN
    -- 1. Database-Level Isolation Guard:
    -- Verify that the executing transaction is running under READ COMMITTED.
    -- Under REPEATABLE READ or SERIALIZABLE, snapshot isolation prevents SELECT SUM(amount)
    -- from observing concurrent committed reversals, creating write-skew anomalies.
    v_isolation := current_setting('transaction_isolation');
    IF v_isolation NOT IN ('read committed', 'read uncommitted') THEN
        RAISE EXCEPTION 'PaymentAllocationReversal requires READ COMMITTED transaction isolation to prevent snapshot isolation write-skew anomalies (current: %). Use READ COMMITTED for financial reversals.',
            v_isolation
            USING ERRCODE = '0A000'; -- feature_not_supported
    END IF;

    -- 2. Validate positive reversal amount
    IF NEW.amount IS NULL OR NEW.amount <= 0 THEN
        RAISE EXCEPTION 'Reversal amount must be positive (received: %)', NEW.amount
            USING ERRCODE = '23514';
    END IF;

    -- 3. Pessimistically lock the parent PaymentAllocation row FOR UPDATE.
    -- In READ COMMITTED, this serializes concurrent reversals against the same allocation
    -- and forces subsequent transactions to wait until the prior transaction commits,
    -- then re-read the latest committed cumulative sum.
    SELECT amount 
    INTO v_allocation_amount
    FROM "PaymentAllocation"
    WHERE id = NEW."originalAllocationId" 
      AND "tenantId" = NEW."tenantId"
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target PaymentAllocation (id: %, tenantId: %) does not exist',
            NEW."originalAllocationId", NEW."tenantId"
            USING ERRCODE = '23503';
    END IF;

    -- 4. Calculate current cumulative reversals already recorded for this allocation
    SELECT COALESCE(SUM(amount), 0)
    INTO v_current_reversal_sum
    FROM "PaymentAllocationReversal"
    WHERE "originalAllocationId" = NEW."originalAllocationId"
      AND "tenantId" = NEW."tenantId";

    -- 5. Reject if the allocation is already fully reversed
    IF v_current_reversal_sum >= v_allocation_amount THEN
        RAISE EXCEPTION 'PaymentAllocation % is already fully reversed (cumulative reversals: %, allocation amount: %)',
            NEW."originalAllocationId", v_current_reversal_sum, v_allocation_amount
            USING ERRCODE = '23514';
    END IF;

    -- 6. Reject if this reversal would cause cumulative reversals to exceed the original allocation amount
    IF (v_current_reversal_sum + NEW.amount) > v_allocation_amount THEN
        RAISE EXCEPTION 'Cumulative reversal amount (% + % = %) exceeds original allocation amount (%) for PaymentAllocation %',
            v_current_reversal_sum, NEW.amount, (v_current_reversal_sum + NEW.amount), 
            v_allocation_amount, NEW."originalAllocationId"
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Re-attach trigger
DROP TRIGGER IF EXISTS trg_allocation_reversal_limit ON "PaymentAllocationReversal";
CREATE TRIGGER trg_allocation_reversal_limit
BEFORE INSERT ON "PaymentAllocationReversal"
FOR EACH ROW
EXECUTE FUNCTION fn_enforce_allocation_reversal_limit();

-- Update commit-time deferred invariant trigger function to also check isolation
CREATE OR REPLACE FUNCTION fn_assert_allocation_reversal_invariant()
RETURNS TRIGGER AS $$
DECLARE
    v_allocation_amount INTEGER;
    v_total_reversed INTEGER;
    v_isolation TEXT;
BEGIN
    v_isolation := current_setting('transaction_isolation');
    IF v_isolation NOT IN ('read committed', 'read uncommitted') THEN
        RAISE EXCEPTION 'PaymentAllocationReversal invariant check requires READ COMMITTED isolation (current: %)',
            v_isolation
            USING ERRCODE = '0A000';
    END IF;

    SELECT amount INTO v_allocation_amount
    FROM "PaymentAllocation"
    WHERE id = NEW."originalAllocationId" 
      AND "tenantId" = NEW."tenantId";

    SELECT COALESCE(SUM(amount), 0) INTO v_total_reversed
    FROM "PaymentAllocationReversal"
    WHERE "originalAllocationId" = NEW."originalAllocationId" 
      AND "tenantId" = NEW."tenantId";

    IF v_total_reversed > v_allocation_amount THEN
        RAISE EXCEPTION 'Cumulative reversal amount (%) exceeds original allocation amount (%) for PaymentAllocation %',
            v_total_reversed, v_allocation_amount, NEW."originalAllocationId"
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_allocation_reversal_invariant ON "PaymentAllocationReversal";
CREATE CONSTRAINT TRIGGER trg_allocation_reversal_invariant
AFTER INSERT ON "PaymentAllocationReversal"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION fn_assert_allocation_reversal_invariant();
