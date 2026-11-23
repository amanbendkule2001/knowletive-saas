import fs from 'fs';

const inventory = JSON.parse(fs.readFileSync('scripts/rehearsal_functions_inventory.json', 'utf8'));

console.log('=== ACCURATE AUDIT OF 28 TRIGGER FUNCTIONS FOR TABLE REFERENCES ===\n');

const knownTables = [
  'AcademicYear', 'AiJob', 'Announcement', 'Attendance', 'AuditLog',
  'Batch', 'BatchEnrollmentEvent', 'BatchStudent', 'BatchTeacher', 'Branch',
  'BranchLedgerEntry', 'BranchPayout', 'BranchReconciliationAudit', 'ClassLevel',
  'CopilotMessage', 'CopilotThread', 'CreditTransferApprovalEvent', 'CreditTransferJournal',
  'CreditTransferPosting', 'CreditTransferRequest', 'CreditTransferSourceAllocation',
  'DemoFeeInstallment', 'DemoFeePlan', 'DemoPaymentSession', 'DemoPaymentTransaction',
  'ExamEnrollment', 'ExamMark', 'ExamMarksRevisionEvent', 'ExamResult',
  'ExamResultSnapshot', 'ExamSubject', 'Examination', 'FeeInvoice', 'FeePayment',
  'FeePaymentLink', 'FileAsset', 'GradeBand', 'GradeScale', 'Guardian',
  'GuardianConsent', 'GuardianConsentEvent', 'InstallmentScheduleChange', 'Invoice',
  'Lead', 'LeadActivity', 'LessonPlan', 'Membership', 'MembershipBranch',
  'NotificationLog', 'PasswordResetToken', 'Payment', 'PaymentAllocation',
  'PaymentAllocationReversal', 'PaymentCollectorRoute', 'PaymentProviderConfig',
  'PaymentReceipt', 'PaymentReceiptBalance', 'Permission', 'Plan', 'RateLimitBucket',
  'Role', 'RolePermission', 'Section', 'Session', 'Setting', 'Student',
  'StudentCreditAccount', 'StudentFeeInstallment', 'StudentFeePlan', 'StudentGuardian',
  'Subject', 'SyllabusChapter', 'SyllabusProgressEvent', 'SyllabusTeacher',
  'SyllabusTopic', 'SyllabusTrack', 'Tenant', 'TenantSubscription', 'TenantUsage',
  'TopicProgress', 'User', 'WebhookEvent'
];

const results = [];

for (const [name, data] of Object.entries(inventory)) {
  if (name === 'fn_get_effective_branch_id') continue;

  const def = data.definition;
  const attachedTables = data.triggers.map(t => t.table);
  
  const unqualifiedFound = [];
  const qualifiedFound = [];

  for (const table of knownTables) {
    // Check for qualified: public."Table"
    const hasQualified = def.includes(`public."${table}"`);
    if (hasQualified) {
      qualifiedFound.push(table);
    }

    // Check for unqualified: "Table" NOT preceded by public.
    const stripped = def.replace(new RegExp(`public\\."${table}"`, 'g'), '__QUALIFIED__');
    if (stripped.includes(`"${table}"`)) {
      unqualifiedFound.push(table);
    }
  }

  // Cross table access (queries tables other than the trigger table)
  const crossTableUnqualified = unqualifiedFound.filter(t => !attachedTables.includes(t));
  const crossTableQualified = qualifiedFound.filter(t => !attachedTables.includes(t));

  results.push({
    name,
    attachedTables: [...new Set(attachedTables)],
    triggers: data.triggers.map(t => `${t.timing} ${t.events} ON ${t.table}`),
    unqualifiedTables: unqualifiedFound,
    qualifiedTables: qualifiedFound,
    crossTableUnqualified,
    crossTableQualified,
    isVulnerableToShadowing: unqualifiedFound.length > 0,
    hasSearchPath: /SET\s+search_path/i.test(def),
    hasDynamicSql: /EXECUTE\s+/i.test(def)
  });
}

console.log(`Audited ${results.length} trigger functions.\n`);

const vulnerable = results.filter(r => r.isVulnerableToShadowing);
console.log(`Found ${vulnerable.length} functions with UNQUALIFIED table references:\n`);

vulnerable.forEach((v, idx) => {
  console.log(`${idx + 1}. Function: ${v.name}`);
  console.log(`   Attached Table(s): ${v.attachedTables.join(', ')}`);
  console.log(`   Triggers: ${v.triggers.join('; ')}`);
  console.log(`   Unqualified Tables: ${v.unqualifiedTables.join(', ')}`);
  console.log(`   Cross-Table Unqualified: ${v.crossTableUnqualified.length ? v.crossTableUnqualified.join(', ') : 'None (Only references attached table)'}`);
  console.log('');
});

const fullyQualified = results.filter(r => !r.isVulnerableToShadowing);
console.log(`\nFound ${fullyQualified.length} functions with NO unqualified table references:\n`);
fullyQualified.forEach((fq, idx) => {
  console.log(`${idx + 1}. ${fq.name} (Attached: ${fq.attachedTables.join(', ')})`);
});

fs.writeFileSync('scripts/audit_detailed_table_references.json', JSON.stringify(results, null, 2));
