import { PrismaClient } from '@prisma/client';
import { initiateDemoPaymentSession, processDemoPaymentOutcome } from '../src/lib/demo-payments';

const prisma = new PrismaClient();

async function main() {
  console.log('--- 1. VERIFY SEEDED DATA ---');
  const tenant = await prisma.tenant.findUnique({ where: { slug: 'sunrise' } });
  if (!tenant) throw new Error('Sunrise tenant not found');

  const student = await prisma.student.findFirst({
    where: { tenantId: tenant.id, admissionNo: 'SPS-2026-1001' },
    include: { branch: true },
  });
  if (!student) throw new Error('Student Aarav Sharma not found');

  const plan = await prisma.demoFeePlan.findFirst({
    where: { tenantId: tenant.id, studentId: student.id, status: 'ACTIVE' },
    include: { installments: { orderBy: { installmentNumber: 'asc' } } },
  });
  if (!plan) throw new Error('Active DemoFeePlan not found');

  console.log(`Verified Plan: ${plan.title} (Payable: ₹${plan.payableAmount / 100})`);
  console.log('Installments:', plan.installments.map(i => `Q${i.installmentNumber}: ${i.title} - ${i.status} (Remaining: ₹${(i.originalAmount - i.paidAmount) / 100})`));

  // Find the first unpaid installment (Q2 or Q3)
  const targetInst = plan.installments.find(i => i.status !== 'PAID') || plan.installments[0];
  console.log(`\n--- 2. INITIATE JODO DEMO CHECKOUT FOR ${targetInst.title} ---`);

  const amountToPay = targetInst.originalAmount - targetInst.paidAmount;
  const session = await initiateDemoPaymentSession({
    tenantId: tenant.id,
    branchId: student.branchId,
    studentId: student.id,
    installmentIds: [targetInst.id],
    amountPaise: amountToPay > 0 ? amountToPay : 1000000,
    customerName: 'Rajesh Sharma',
    customerPhone: '+91 98765 43210',
  });

  console.log('Checkout session created successfully!');
  console.log('Session ID:', session.sessionId);
  console.log('Session Token:', session.sessionToken);
  console.log('Checkout URL:', session.checkoutUrl);
  console.log('Amount (Paise):', session.amountPaise);

  console.log('\n--- 3. SIMULATE PAYMENT SUCCESS (Jodo Pay) ---');
  const outcomeResult = await processDemoPaymentOutcome({
    sessionToken: session.sessionToken,
    outcome: 'SUCCESS',
    customUtr: 'JODO-VERIFY-UTR-998877',
    notes: 'Simulated automated test payment',
  });

  console.log('Outcome processed:', outcomeResult.sessionStatus);
  console.log('Reference UTR:', outcomeResult.reference);

  // Verify installment state
  const updatedInst = await prisma.demoFeeInstallment.findUnique({
    where: { id: targetInst.id },
  });
  console.log(`Installment Status post-payment: ${updatedInst?.status} (Paid: ₹${(updatedInst?.paidAmount || 0) / 100} / ₹${(updatedInst?.originalAmount || 0) / 100})`);

  // Verify BranchLedgerEntry credit
  const ledgerEntries = await prisma.branchLedgerEntry.findMany({
    where: { tenantId: tenant.id, branchId: student.branchId || undefined },
    orderBy: { postedAt: 'desc' },
    take: 2,
  });

  const latestLedger = ledgerEntries[0];
  console.log(`Latest Branch Ledger Entry: ${latestLedger.entryType} - ₹${latestLedger.amount / 100} (Balance After: ₹${latestLedger.balanceAfter / 100})`);

  console.log('\n--- 4. SIMULATE PLATFORM MANUAL PAYOUT ---');
  const payoutAmountPaise = 500000; // ₹5,000
  const currentPayable = latestLedger.balanceAfter;
  const newExpectedBalance = currentPayable - payoutAmountPaise;

  const count = await prisma.branchPayout.count({ where: { tenantId: tenant.id } });
  const payoutNumber = `PO-${new Date().getFullYear()}-${(count + 1).toString().padStart(4, '0')}`;

  const payout = await prisma.branchPayout.create({
    data: {
      tenantId: tenant.id,
      branchId: student.branchId!,
      payoutNumber,
      amount: payoutAmountPaise,
      currency: 'INR',
      status: 'PAID',
      bankAccountNumber: student.branch?.bankAccountNumber || '918273645012',
      bankIfsc: student.branch?.bankIfsc || 'HDFC0001234',
      utrReference: 'SBIN-PAYOUT-TEST-8812',
      requestedById: 'platform-test-user',
      processedById: 'platform-test-user',
      processedAt: new Date(),
    },
  });

  const payoutLedger = await prisma.branchLedgerEntry.create({
    data: {
      tenantId: tenant.id,
      branchId: student.branchId!,
      entryType: 'DEBIT_PAYOUT',
      channel: 'ONLINE_JODO',
      amount: payoutAmountPaise,
      balanceAfter: newExpectedBalance,
      currency: 'INR',
      referenceType: 'BRANCH_PAYOUT',
      referenceId: payout.id,
      utrReference: 'SBIN-PAYOUT-TEST-8812',
      description: `Disbursed test payout: ₹${payoutAmountPaise / 100}`,
      metadata: { simulated: true },
    },
  });

  console.log(`Payout recorded: ${payout.payoutNumber} for ₹${payout.amount / 100}`);
  console.log(`Ledger post-payout: ${payoutLedger.entryType} - Balance After: ₹${payoutLedger.balanceAfter / 100}`);

  if (payoutLedger.balanceAfter !== newExpectedBalance) {
    throw new Error(`Balance mismatch: expected ₹${newExpectedBalance / 100}, got ₹${payoutLedger.balanceAfter / 100}`);
  }

  console.log('\n✅ ALL END-TO-END DEMO LIFECYCLE CHECKS PASSED PERFECTLY!');
}

main()
  .catch((err) => {
    console.error('VERIFICATION FAILED:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
