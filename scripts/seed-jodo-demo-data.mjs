import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const sunrise = await prisma.tenant.findUnique({
    where: { slug: 'sunrise' },
  });

  if (!sunrise) {
    console.error('Sunrise tenant not found');
    return;
  }

  const tenantId = sunrise.id;
  console.log('Seeding demo data for Sunrise:', tenantId);

  // 1. Ensure Main Branch and Sub-Branch exist
  let mainBranch = await prisma.branch.findFirst({
    where: { tenantId, code: 'MAIN' },
  });

  if (!mainBranch) {
    mainBranch = await prisma.branch.create({
      data: {
        tenantId,
        name: 'Sunrise Main Campus',
        code: 'MAIN',
        branchType: 'MAIN',
        collectorCode: 'COL-SUN-MAIN',
        verificationStatus: 'VERIFIED',
        bankAccountName: 'Sunrise Public School - Main Operating A/C',
        bankAccountNumber: '918273645012',
        bankIfsc: 'HDFC0001234',
        bankBankName: 'HDFC Bank, Vasant Kunj',
        isActive: true,
      },
    });
    console.log('Created Main Branch:', mainBranch.id);
  }

  let subBranch = await prisma.branch.findFirst({
    where: { tenantId, code: 'EAST' },
  });

  if (!subBranch) {
    subBranch = await prisma.branch.create({
      data: {
        tenantId,
        parentBranchId: mainBranch.id,
        name: 'Sunrise East Sub-Campus',
        code: 'EAST',
        branchType: 'SUB_BRANCH',
        collectorCode: 'COL-SUN-EAST',
        verificationStatus: 'VERIFIED',
        bankAccountName: 'Sunrise Public School - East Branch A/C',
        bankAccountNumber: '918273645099',
        bankIfsc: 'HDFC0005678',
        bankBankName: 'HDFC Bank, Preet Vihar',
        isActive: true,
      },
    });
    console.log('Created Sub Branch:', subBranch.id);
  }

  // 2. Ensure PaymentCollectorRoute exists
  const existingRoutes = await prisma.paymentCollectorRoute.findMany({ where: { tenantId } });
  if (existingRoutes.length === 0) {
    await prisma.paymentCollectorRoute.createMany({
      data: [
        {
          tenantId,
          branchId: mainBranch.id,
          provider: 'JODO',
          environment: 'DEMO',
          collectorCode: 'COL-SUN-MAIN',
          isActive: true,
        },
        {
          tenantId,
          branchId: subBranch.id,
          provider: 'JODO',
          environment: 'DEMO',
          collectorCode: 'COL-SUN-EAST',
          isActive: true,
        },
      ],
    });
    console.log('Created PaymentCollectorRoutes');
  }

  // 3. Ensure PaymentProviderConfig exists
  const config = await prisma.paymentProviderConfig.findFirst({
    where: { tenantId, provider: 'JODO', environment: 'DEMO' },
  });
  if (!config) {
    await prisma.paymentProviderConfig.create({
      data: {
        tenantId,
        provider: 'JODO',
        environment: 'DEMO',
        merchantId: 'JODO_DEMO_SUNRISE',
        collectorCode: 'COL-SUN-MAIN',
        isEnabled: true,
      },
    });
    console.log('Created PaymentProviderConfig');
  }

  // 4. Find student Aarav Sharma
  const student = await prisma.student.findFirst({
    where: { tenantId, admissionNo: 'SPS-2026-1001' },
  });

  if (!student) {
    console.error('Student Aarav Sharma not found');
    return;
  }

  // Assign student to main branch if not already
  if (!student.branchId) {
    await prisma.student.update({
      where: { id: student.id },
      data: { branchId: mainBranch.id },
    });
    console.log('Assigned Aarav Sharma to Main Branch');
  }

  // 5. Check if Aarav Sharma already has a DemoFeePlan
  const existingPlan = await prisma.demoFeePlan.findFirst({
    where: { studentId: student.id, tenantId },
    include: { installments: true },
  });

  if (!existingPlan) {
    const plan = await prisma.demoFeePlan.create({
      data: {
        tenantId,
        branchId: mainBranch.id,
        studentId: student.id,
        title: 'Academic Year 2026–27 Installment Plan (Jodo Demo)',
        totalAmount: 5000000, // ₹50,000
        discountAmount: 0,
        payableAmount: 5000000,
        scheduleType: 'QUARTERLY',
        status: 'ACTIVE',
        notes: 'Annual composite tuition, lab, library & computer fees divided into 4 quarterly installments.',
      },
    });

    const now = new Date();
    const inst1Due = new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000);
    const inst2Due = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000); // in 5 days (DUE)
    const inst3Due = new Date(now.getTime() + 65 * 24 * 60 * 60 * 1000);
    const inst4Due = new Date(now.getTime() + 155 * 24 * 60 * 60 * 1000);

    const inst1 = await prisma.demoFeeInstallment.create({
      data: {
        tenantId,
        branchId: mainBranch.id,
        studentId: student.id,
        demoPlanId: plan.id,
        installmentNumber: 1,
        title: 'Q1 Admission & Tuition Fee',
        dueDate: inst1Due,
        originalAmount: 1500000,
        paidAmount: 1500000,
        status: 'PAID',
      },
    });

    const inst2 = await prisma.demoFeeInstallment.create({
      data: {
        tenantId,
        branchId: mainBranch.id,
        studentId: student.id,
        demoPlanId: plan.id,
        installmentNumber: 2,
        title: 'Q2 Tuition & Lab Fee',
        dueDate: inst2Due,
        originalAmount: 1250000,
        paidAmount: 0,
        status: 'DUE',
      },
    });

    const inst3 = await prisma.demoFeeInstallment.create({
      data: {
        tenantId,
        branchId: mainBranch.id,
        studentId: student.id,
        demoPlanId: plan.id,
        installmentNumber: 3,
        title: 'Q3 Tuition & Sports Fee',
        dueDate: inst3Due,
        originalAmount: 1250000,
        paidAmount: 0,
        status: 'UPCOMING',
      },
    });

    const inst4 = await prisma.demoFeeInstallment.create({
      data: {
        tenantId,
        branchId: mainBranch.id,
        studentId: student.id,
        demoPlanId: plan.id,
        installmentNumber: 4,
        title: 'Q4 Final Term Fee',
        dueDate: inst4Due,
        originalAmount: 1000000,
        paidAmount: 0,
        status: 'UPCOMING',
      },
    });

    // Create a demo payment session for the paid Q1 installment
    const session = await prisma.demoPaymentSession.create({
      data: {
        tenantId,
        branchId: mainBranch.id,
        studentId: student.id,
        sessionToken: 'demo_settled_q1_session_token',
        tokenHash: 'demo_settled_q1_token_hash',
        amount: 1500000,
        currency: 'INR',
        status: 'SUCCESS',
        installmentIds: [inst1.id],
        expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        payerName: 'Rajesh Sharma',
        payerPhone: '+91 98765 43210',
        completedAt: inst1Due,
      },
    });

    await prisma.demoPaymentTransaction.create({
      data: {
        tenantId,
        sessionId: session.id,
        demoInstallmentId: inst1.id,
        amount: 1500000,
        status: 'SUCCESS',
        reference: 'JODO-DEMO-UTR-9182741',
        simulationOutcome: 'SUCCESS',
        createdAt: inst1Due,
      },
    });

    console.log('Created DemoFeePlan and installments for Aarav Sharma');
  }

  // 6. Ensure BranchLedgerEntry exists for Main Campus
  const existingLedger = await prisma.branchLedgerEntry.findFirst({
    where: { tenantId, branchId: mainBranch.id },
  });

  if (!existingLedger) {
    await prisma.branchLedgerEntry.create({
      data: {
        tenantId,
        branchId: mainBranch.id,
        entryType: 'CREDIT_SETTLEMENT',
        channel: 'ONLINE_JODO',
        amount: 1500000, // ₹15,000 settled from Q1
        balanceAfter: 1500000,
        currency: 'INR',
        referenceType: 'PAYMENT_SETTLEMENT',
        referenceId: 'JODO-SETTLE-001',
        utrReference: 'SBIN00192837461',
        description: 'Simulated Jodo Gateway Settlement: Q1 Fee Collection',
        metadata: {
          simulated: true,
          settlementUtr: 'SBIN00192837461',
          jodoBatchId: 'JODO_BATCH_2026_01',
        },
      },
    });
    console.log('Created initial BranchLedgerEntry for Main Branch');
  }

  console.log('Demo seed completed successfully!');
}

main().catch(console.error).finally(() => prisma.$disconnect());
