-- Stage 1.4: Payment Allocation Reversal Cumulative Limit and Concurrency Hardening
-- Enforces: SUM(PaymentAllocationReversal.amount) <= PaymentAllocation.amount
-- Serializes concurrent reversal attempts via pessimistic row locking on parent PaymentAllocation.

-- 1. Function to enforce cumulative reversal limits and serialize concurrency
CREATE OR REPLACE FUNCTION fn_enforce_allocation_reversal_limit()
RETURNS TRIGGER AS $$
DECLARE
    v_allocation_amount INTEGER;
    v_current_reversal_sum INTEGER;
BEGIN
    -- Validate positive reversal amount
    IF NEW.amount IS NULL OR NEW.amount <= 0 THEN
        RAISE EXCEPTION 'Reversal amount must be positive (received: %)', NEW.amount
            USING ERRCODE = '23514';
    END IF;

    -- Pessimistically lock the parent PaymentAllocation row FOR UPDATE.
    -- This serializes concurrent reversals against the same allocation and eliminates
    -- race conditions / phantom read over-reversals across independent connections.
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

    -- Calculate current cumulative reversals already recorded for this allocation
    SELECT COALESCE(SUM(amount), 0)
    INTO v_current_reversal_sum
    FROM "PaymentAllocationReversal"
    WHERE "originalAllocationId" = NEW."originalAllocationId"
      AND "tenantId" = NEW."tenantId";

    -- Reject if the allocation is already fully reversed
    IF v_current_reversal_sum >= v_allocation_amount THEN
        RAISE EXCEPTION 'PaymentAllocation % is already fully reversed (cumulative reversals: %, allocation amount: %)',
            NEW."originalAllocationId", v_current_reversal_sum, v_allocation_amount
            USING ERRCODE = '23514';
    END IF;

    -- Reject if this reversal would cause cumulative reversals to exceed the original allocation amount
    IF (v_current_reversal_sum + NEW.amount) > v_allocation_amount THEN
        RAISE EXCEPTION 'Cumulative reversal amount (% + % = %) exceeds original allocation amount (%) for PaymentAllocation %',
            v_current_reversal_sum, NEW.amount, (v_current_reversal_sum + NEW.amount), 
            v_allocation_amount, NEW."originalAllocationId"
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Drop existing trigger if any and create BEFORE INSERT trigger
DROP TRIGGER IF EXISTS trg_allocation_reversal_limit ON "PaymentAllocationReversal";
CREATE TRIGGER trg_allocation_reversal_limit
BEFORE INSERT ON "PaymentAllocationReversal"
FOR EACH ROW
EXECUTE FUNCTION fn_enforce_allocation_reversal_limit();

-- 3. Deferred constraint trigger asserting cumulative invariant across transaction boundaries
CREATE OR REPLACE FUNCTION fn_assert_allocation_reversal_invariant()
RETURNS TRIGGER AS $$
DECLARE
    v_allocation_amount INTEGER;
    v_total_reversed INTEGER;
BEGIN
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
