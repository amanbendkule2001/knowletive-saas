import fs from "fs";

const inv = JSON.parse(fs.readFileSync("scratch/original-db-inventory.json", "utf8"));

// Helpers
const hasTable = (t) => inv.tableCounts.some(x => x.table === t);
const hasCol = (t, c) => inv.columns.some(x => x.table_name === t && x.column_name === c);
const hasConstraint = (c) => inv.foreignKeys.some(x => x.constraint_name === c) || 
                             inv.uniqueConstraints.some(x => x.constraint_name === c) ||
                             inv.checkConstraints.some(x => x.constraint_name === c) ||
                             inv.primaryKeys.some(x => x.constraint_name === c);
const hasIndex = (i) => inv.indexes.some(x => x.indexname === i);
const hasEnum = (e) => inv.enums.some(x => x.typname === e);
const hasFunc = (f) => inv.functions.some(x => x.proname === f);
const hasView = (v) => inv.views.some(x => x.viewname === v);
const hasTrigger = (t) => inv.triggers.some(x => x.trigger_name === t);

console.log("=== CHECKING MIGRATIONS AGAINST ORIGINAL DB CATALOG ===");

const checks = [
  {
    mig: "20261101000000_baseline_schema",
    items: [
      { name: "Table: User", ok: hasTable("User") },
      { name: "Table: Tenant", ok: hasTable("Tenant") },
      { name: "Table: Student", ok: hasTable("Student") },
      { name: "Table: FeeInvoice", ok: hasTable("FeeInvoice") },
      { name: "Table: Attendance", ok: hasTable("Attendance") },
      { name: "Table: AuditLog", ok: hasTable("AuditLog") },
      { name: "Table: WebhookEvent", ok: hasTable("WebhookEvent") }
    ]
  },
  {
    mig: "20261118104700_core_financial_ledger_stage1",
    items: [
      { name: "Table: PaymentReceipt", ok: hasTable("PaymentReceipt") },
      { name: "Table: PaymentReceiptBalance", ok: hasTable("PaymentReceiptBalance") },
      { name: "Table: PaymentAllocation", ok: hasTable("PaymentAllocation") },
      { name: "Table: PaymentAllocationReversal", ok: hasTable("PaymentAllocationReversal") },
      { name: "Trigger: trg_receipt_conservation", ok: hasTrigger("trg_receipt_conservation") },
      { name: "Func: fn_enforce_receipt_balance_conservation", ok: hasFunc("fn_enforce_receipt_balance_conservation") }
    ]
  },
  {
    mig: "20261118122500_stage2_1_student_credit_and_double_entry_transfers",
    items: [
      { name: "Table: StudentCreditAccount", ok: hasTable("StudentCreditAccount") },
      { name: "Table: CreditTransferRequest", ok: hasTable("CreditTransferRequest") },
      { name: "Table: CreditTransferJournal", ok: hasTable("CreditTransferJournal") },
      { name: "Table: CreditTransferPosting", ok: hasTable("CreditTransferPosting") },
      { name: "Table: CreditTransferApprovalEvent", ok: hasTable("CreditTransferApprovalEvent") },
      { name: "Table: CreditTransferSourceAllocation", ok: hasTable("CreditTransferSourceAllocation") }
    ]
  },
  {
    mig: "20261118134500_stage2_2_2_guardian_consent_hardening",
    items: [
      { name: "Table: GuardianConsent", ok: hasTable("GuardianConsent") },
      { name: "Table: GuardianConsentEvent", ok: hasTable("GuardianConsentEvent") }
    ]
  },
  {
    mig: "20261120120000_branch_isolation_two_track_ledger",
    items: [
      { name: "Table: Branch", ok: hasTable("Branch") },
      { name: "Table: BranchLedgerEntry", ok: hasTable("BranchLedgerEntry") },
      { name: "Table: BranchPayout", ok: hasTable("BranchPayout") },
      { name: "Enum: BranchType", ok: hasEnum("BranchType") },
      { name: "Enum: BranchVerificationStatus", ok: hasEnum("BranchVerificationStatus") }
    ]
  },
  {
    mig: "20261120173000_student_installments_and_demo_payments",
    items: [
      { name: "Table: StudentFeePlan", ok: hasTable("StudentFeePlan") },
      { name: "Table: StudentFeeInstallment", ok: hasTable("StudentFeeInstallment") },
      { name: "Table: DemoFeePlan", ok: hasTable("DemoFeePlan") },
      { name: "Table: DemoFeeInstallment", ok: hasTable("DemoFeeInstallment") },
      { name: "Table: DemoPaymentSession", ok: hasTable("DemoPaymentSession") },
      { name: "Table: DemoPaymentTransaction", ok: hasTable("DemoPaymentTransaction") },
      { name: "Table: PaymentProviderConfig", ok: hasTable("PaymentProviderConfig") }
    ]
  },
  {
    mig: "20261120190000_lead_branch_isolation",
    items: [
      { name: "Col: Lead.branchId", ok: hasCol("Lead", "branchId") }
    ]
  },
  {
    mig: "20261120193000_tenant_aware_lead_branch_integrity",
    items: [
      { name: "FK: Lead_tenantId_branchId_fkey", ok: hasConstraint("Lead_tenantId_branchId_fkey") }
    ]
  },
  {
    mig: "20261121110000_enterprise_branch_hierarchy_and_multi_branch",
    items: [
      { name: "Table: MembershipBranch", ok: hasTable("MembershipBranch") },
      { name: "Table: BranchReconciliationAudit", ok: hasTable("BranchReconciliationAudit") },
      { name: "Col: Branch.parentBranchId", ok: hasCol("Branch", "parentBranchId") },
      { name: "Enum: BranchAssignmentScopeMode", ok: hasEnum("BranchAssignmentScopeMode") }
    ]
  },
  {
    mig: "20261121120000_phase2_1_collector_routing_and_hardening",
    items: [
      { name: "Table: PaymentCollectorRoute", ok: hasTable("PaymentCollectorRoute") },
      { name: "Col: Branch.collectorCode", ok: hasCol("Branch", "collectorCode") }
    ]
  },
  {
    mig: "20261121130000_phase2_2_pre_rls_integrity_and_branch_hardening",
    items: [
      { name: "Index: uq_pcr_branch_route_identity", ok: hasIndex("uq_pcr_branch_route_identity") },
      { name: "Index: uq_pcr_explicit_discriminator", ok: hasIndex("uq_pcr_explicit_discriminator") },
      { name: "FK: PaymentCollectorRoute_tenantId_branchId_fkey", ok: hasConstraint("PaymentCollectorRoute_tenantId_branchId_fkey") }
    ]
  },
  {
    mig: "20261121140000_phase2_3_collector_routing_correction_and_pre_rls",
    items: [
      { name: "View: v_effective_fee_payment", ok: hasView("v_effective_fee_payment") },
      { name: "View: v_effective_payment_receipt", ok: hasView("v_effective_payment_receipt") },
      { name: "View: v_effective_payment_allocation", ok: hasView("v_effective_payment_allocation") },
      { name: "Func: fn_get_effective_branch_id", ok: hasFunc("fn_get_effective_branch_id") }
    ]
  },
  {
    mig: "20261121150000_phase2_3_1_pre_rls_hardening",
    items: [
      { name: "FK: PaymentAllocation_tenantId_branchId_fkey", ok: hasConstraint("PaymentAllocation_tenantId_branchId_fkey") },
      { name: "FK: CreditTransferJournal_tenantId_sourceBranchId_fkey", ok: hasConstraint("CreditTransferJournal_tenantId_sourceBranchId_fkey") },
      { name: "FK: CreditTransferJournal_tenantId_targetBranchId_fkey", ok: hasConstraint("CreditTransferJournal_tenantId_targetBranchId_fkey") }
    ]
  },
  {
    mig: "20261121160000_phase2_3_3_remediation_and_canonical_closure",
    items: [
      { name: "Table: CopilotThread", ok: hasTable("CopilotThread") },
      { name: "Table: CopilotMessage", ok: hasTable("CopilotMessage") },
      { name: "Col: WebhookEvent.rawPayload", ok: hasCol("WebhookEvent", "rawPayload") },
      { name: "Col: WebhookEvent.tenantId", ok: hasCol("WebhookEvent", "tenantId") },
      { name: "Col: WebhookEvent.branchId", ok: hasCol("WebhookEvent", "branchId") },
      { name: "Col: WebhookEvent.status", ok: hasCol("WebhookEvent", "status") },
      { name: "FK: PaymentReceipt_tenantId_branchId_fkey", ok: hasConstraint("PaymentReceipt_tenantId_branchId_fkey") },
      { name: "FK: FeePayment_tenantId_branchId_fkey", ok: hasConstraint("FeePayment_tenantId_branchId_fkey") }
    ]
  }
];

for (const c of checks) {
  console.log(`\nMigration: ${c.mig}`);
  for (const item of c.items) {
    console.log(`  ${item.ok ? '✓' : '✗'} ${item.name}`);
  }
}
