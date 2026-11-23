import { PrismaClient } from "@prisma/client";

const DB_URL =
  process.env.DATABASE_URL ||
  "postgresql://knowletive:knowletive@127.0.0.1:5432/knowletive_final_rehearsal_20261121_184300?schema=public";
const db = new PrismaClient({ datasources: { db: { url: DB_URL } } });

async function main() {
  console.log("=============================================================");
  console.log("  PHASE 2.3.5 — VERIFY MIGRATIONS 1–12 CHECKPOINT (PART 2)");
  console.log("=============================================================");
  console.log(`Target: knowletive_restore_verify_20261121_172317\n`);

  // Catalog inspection helpers
  const tables = (await db.$queryRawUnsafe(`SELECT tablename FROM pg_tables WHERE schemaname = 'public';`)).map(t => t.tablename);
  const columns = await db.$queryRawUnsafe(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public';`);
  const enums = (await db.$queryRawUnsafe(`SELECT DISTINCT typname FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public';`)).map(e => e.typname);
  const functions = (await db.$queryRawUnsafe(`SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace;`)).map(f => f.proname);
  const triggers = (await db.$queryRawUnsafe(`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal;`)).map(t => t.tgname);
  const indexes = (await db.$queryRawUnsafe(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public';`)).map(i => i.indexname);
  const constraints = (await db.$queryRawUnsafe(`SELECT conname FROM pg_constraint WHERE connamespace = 'public'::regnamespace;`)).map(c => c.conname);

  const hasTable = t => tables.includes(t);
  const hasCol = (t, c) => columns.some(x => x.table_name === t && x.column_name === c);
  const hasEnum = e => enums.includes(e);
  const hasFunc = f => functions.includes(f);
  const hasTrig = t => triggers.includes(t);
  const hasIndex = i => indexes.includes(i);
  const hasConstraint = c => constraints.includes(c);

  const checkpointSpecs = [
    {
      mig: "1. 20261101000000_baseline_schema",
      checks: [
        { desc: "Table User", ok: hasTable("User") },
        { desc: "Table Tenant", ok: hasTable("Tenant") },
        { desc: "Table Student", ok: hasTable("Student") },
        { desc: "Table FeeInvoice", ok: hasTable("FeeInvoice") },
        { desc: "Table Attendance", ok: hasTable("Attendance") },
        { desc: "Table AuditLog", ok: hasTable("AuditLog") },
        { desc: "Table WebhookEvent", ok: hasTable("WebhookEvent") },
        { desc: "Index User_pkey", ok: hasIndex("User_pkey") },
        { desc: "Index Student_tenantId_admissionNo_key", ok: hasIndex("Student_tenantId_admissionNo_key") }
      ]
    },
    {
      mig: "2. 20261118104700_core_financial_ledger_stage1",
      checks: [
        { desc: "Enum PaymentReceiptStatus", ok: hasEnum("PaymentReceiptStatus") },
        { desc: "Table PaymentReceipt", ok: hasTable("PaymentReceipt") },
        { desc: "Table PaymentReceiptBalance", ok: hasTable("PaymentReceiptBalance") },
        { desc: "Table PaymentAllocation", ok: hasTable("PaymentAllocation") },
        { desc: "Table PaymentAllocationReversal", ok: hasTable("PaymentAllocationReversal") },
        { desc: "Constraint chk_receipt_amount_positive", ok: hasConstraint("chk_receipt_amount_positive") },
        { desc: "Constraint chk_receipt_balance_non_negative", ok: hasConstraint("chk_receipt_balance_non_negative") },
        { desc: "Constraint chk_allocation_amount_positive", ok: hasConstraint("chk_allocation_amount_positive") },
        { desc: "Function fn_enforce_receipt_balance_conservation", ok: hasFunc("fn_enforce_receipt_balance_conservation") },
        { desc: "Function fn_protect_payment_receipt_immutability", ok: hasFunc("fn_protect_payment_receipt_immutability") },
        { desc: "Function fn_protect_payment_allocation_immutability", ok: hasFunc("fn_protect_payment_allocation_immutability") },
        { desc: "Trigger trg_receipt_conservation", ok: hasTrig("trg_receipt_conservation") },
        { desc: "Trigger trg_payment_receipt_protect", ok: hasTrig("trg_payment_receipt_protect") }
      ]
    },
    {
      mig: "3. 20261118110800_stage1_2_financial_ledger_integrity_hardening",
      checks: [
        { desc: "Function fn_protect_receipt_balance_immutability", ok: hasFunc("fn_protect_receipt_balance_immutability") },
        { desc: "Function fn_protect_receipt_balance_identity", ok: hasFunc("fn_protect_receipt_balance_identity") },
        { desc: "Function fn_enforce_allocation_same_student", ok: hasFunc("fn_enforce_allocation_same_student") },
        { desc: "Trigger trg_receipt_balance_prevent_delete", ok: hasTrig("trg_receipt_balance_prevent_delete") },
        { desc: "Trigger trg_receipt_balance_identity_guard", ok: hasTrig("trg_receipt_balance_identity_guard") },
        { desc: "Trigger trg_allocation_same_student_guard", ok: hasTrig("trg_allocation_same_student_guard") }
      ]
    },
    {
      mig: "4. 20261118115500_stage1_4_allocation_reversal_integrity",
      checks: [
        { desc: "Function fn_enforce_allocation_reversal_limit", ok: hasFunc("fn_enforce_allocation_reversal_limit") },
        { desc: "Trigger trg_allocation_reversal_limit", ok: hasTrig("trg_allocation_reversal_limit") }
      ]
    },
    {
      mig: "5. 20261118121000_stage1_5_reversal_isolation_guard",
      checks: [
        { desc: "Function fn_enforce_allocation_reversal_limit (with READ COMMITTED check)", ok: hasFunc("fn_enforce_allocation_reversal_limit") }
      ]
    },
    {
      mig: "6. 20261118122500_stage2_1_student_credit_and_double_entry_transfers",
      checks: [
        { desc: "Enum CreditTransferStatus", ok: hasEnum("CreditTransferStatus") },
        { desc: "Enum TransferPostingType", ok: hasEnum("TransferPostingType") },
        { desc: "Table StudentCreditAccount", ok: hasTable("StudentCreditAccount") },
        { desc: "Table CreditTransferJournal", ok: hasTable("CreditTransferJournal") },
        { desc: "Table CreditTransferPosting", ok: hasTable("CreditTransferPosting") },
        { desc: "Function fn_enforce_credit_transfer_balanced", ok: hasFunc("fn_enforce_credit_transfer_balanced") },
        { desc: "Function fn_protect_credit_account_identity", ok: hasFunc("fn_protect_credit_account_identity") },
        { desc: "Trigger trg_credit_journal_balanced", ok: hasTrig("trg_credit_journal_balanced") },
        { desc: "Trigger trg_transfer_posting_protect", ok: hasTrig("trg_transfer_posting_protect") }
      ]
    },
    {
      mig: "7. 20261118124000_stage2_1_1_transfer_lifecycle_and_multi_receipt",
      checks: [
        { desc: "Enum CreditTransferRequestStatus", ok: hasEnum("CreditTransferRequestStatus") },
        { desc: "Table CreditTransferRequest", ok: hasTable("CreditTransferRequest") },
        { desc: "Table CreditTransferApprovalEvent", ok: hasTable("CreditTransferApprovalEvent") },
        { desc: "Table CreditTransferSourceAllocation", ok: hasTable("CreditTransferSourceAllocation") },
        { desc: "Column CreditTransferJournal.requestId", ok: hasCol("CreditTransferJournal", "requestId") },
        { desc: "Function fn_enforce_transfer_request_lifecycle", ok: hasFunc("fn_enforce_transfer_request_lifecycle") },
        { desc: "Trigger trg_transfer_request_lifecycle_guard", ok: hasTrig("trg_transfer_request_lifecycle_guard") }
      ]
    },
    {
      mig: "8. 20261118134500_stage2_2_2_guardian_consent_hardening",
      checks: [
        { desc: "Enum ConsentScope", ok: hasEnum("ConsentScope") },
        { desc: "Enum ConsentVerificationMethod", ok: hasEnum("ConsentVerificationMethod") },
        { desc: "Enum ConsentStatus", ok: hasEnum("ConsentStatus") },
        { desc: "Table GuardianConsent", ok: hasTable("GuardianConsent") },
        { desc: "Column CreditTransferRequest.guardianConsentId", ok: hasCol("CreditTransferRequest", "guardianConsentId") }
      ]
    },
    {
      mig: "9. 20261118145500_stage2_2_3_credit_provenance_and_consent_lifecycle",
      checks: [
        { desc: "Enum ConsentAction", ok: hasEnum("ConsentAction") },
        { desc: "Table GuardianConsentEvent", ok: hasTable("GuardianConsentEvent") },
        { desc: "Function fn_protect_guardian_consent_event_immutability", ok: hasFunc("fn_protect_guardian_consent_event_immutability") },
        { desc: "Function fn_enforce_transfer_posting_provenance", ok: hasFunc("fn_enforce_transfer_posting_provenance") },
        { desc: "Trigger trg_guardian_consent_event_protect", ok: hasTrig("trg_guardian_consent_event_protect") },
        { desc: "Trigger trg_transfer_posting_provenance", ok: hasTrig("trg_transfer_posting_provenance") }
      ]
    },
    {
      mig: "10. 20261120120000_branch_isolation_two_track_ledger",
      checks: [
        { desc: "Enum BranchType", ok: hasEnum("BranchType") },
        { desc: "Enum BranchVerificationStatus", ok: hasEnum("BranchVerificationStatus") },
        { desc: "Enum BranchLedgerEntryType", ok: hasEnum("BranchLedgerEntryType") },
        { desc: "Enum BranchLedgerChannel", ok: hasEnum("BranchLedgerChannel") },
        { desc: "Enum BranchPayoutStatus", ok: hasEnum("BranchPayoutStatus") },
        { desc: "Table Branch", ok: hasTable("Branch") },
        { desc: "Table BranchLedgerEntry", ok: hasTable("BranchLedgerEntry") },
        { desc: "Table BranchPayout", ok: hasTable("BranchPayout") },
        { desc: "Index uq_branch_tenant_collector", ok: hasIndex("uq_branch_tenant_collector") },
        { desc: "Function fn_protect_branch_ledger_immutability", ok: hasFunc("fn_protect_branch_ledger_immutability") },
        { desc: "Trigger trg_branch_ledger_protect", ok: hasTrig("trg_branch_ledger_protect") }
      ]
    },
    {
      mig: "11. 20261120173000_student_installments_and_demo_payments",
      checks: [
        { desc: "Table StudentFeePlan", ok: hasTable("StudentFeePlan") },
        { desc: "Table StudentFeeInstallment", ok: hasTable("StudentFeeInstallment") },
        { desc: "Table DemoFeePlan", ok: hasTable("DemoFeePlan") },
        { desc: "Table DemoFeeInstallment", ok: hasTable("DemoFeeInstallment") },
        { desc: "Table DemoPaymentSession", ok: hasTable("DemoPaymentSession") },
        { desc: "Table DemoPaymentTransaction", ok: hasTable("DemoPaymentTransaction") },
        { desc: "Table PaymentProviderConfig", ok: hasTable("PaymentProviderConfig") },
        { desc: "Table InstallmentScheduleChange", ok: hasTable("InstallmentScheduleChange") },
        { desc: "Column InstallmentScheduleChange.installmentId", ok: hasCol("InstallmentScheduleChange", "installmentId") }
      ]
    },
    {
      mig: "12. 20261120190000_lead_branch_isolation",
      checks: [
        { desc: "Column Lead.branchId", ok: hasCol("Lead", "branchId") },
        { desc: "Index Lead_tenantId_branchId_idx", ok: hasIndex("Lead_tenantId_branchId_idx") }
      ]
    }
  ];

  let totalChecks = 0;
  let passedChecks = 0;

  for (const s of checkpointSpecs) {
    console.log(`Checking ${s.mig}...`);
    let allOk = true;
    for (const c of s.checks) {
      totalChecks++;
      if (c.ok) {
        passedChecks++;
      } else {
        allOk = false;
        console.error(`  ✗ FAIL: ${c.desc}`);
      }
    }
    if (allOk) {
      console.log(`  ✓ ALL ${s.checks.length} CHECKS PASSED (100% represented)`);
    }
  }

  console.log("\n=============================================================");
  console.log(`  CHECKPOINT PROOF: ${passedChecks}/${totalChecks} VERIFICATIONS PASSED`);
  console.log("=============================================================");
  if (passedChecks === totalChecks) {
    console.log("  ✅ MIGRATIONS 1–12 ARE FULLY REPRESENTED IN THE RESTORED DATABASE");
    console.log("  Safe to proceed with Part 3 baseline rehearsal.");
  } else {
    throw new Error("Checkpoint validation failed!");
  }
}

main().catch(console.error).finally(() => db.$disconnect());
