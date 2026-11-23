-- Stage 4.3 / Phase 2: Database-level guardrail for FeeInvoice paidAmount
-- Enforces that FeeInvoice.paidAmount cannot exceed FeeInvoice.amount at the database engine level.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fee_invoice_paid_amount_check'
  ) THEN
    ALTER TABLE "FeeInvoice" ADD CONSTRAINT "fee_invoice_paid_amount_check" CHECK ("paidAmount" <= "amount");
  END IF;
END $$;
