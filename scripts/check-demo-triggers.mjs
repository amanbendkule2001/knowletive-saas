import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const triggers = await prisma.$queryRaw`
    SELECT event_object_table, trigger_name, action_statement, action_timing, event_manipulation
    FROM information_schema.triggers
    WHERE event_object_table IN ('BranchLedgerEntry', 'BranchPayout', 'DemoPaymentTransaction', 'DemoPaymentSession', 'DemoFeeInstallment', 'DemoFeePlan', 'Branch', 'PaymentCollectorRoute', 'PaymentProviderConfig');
  `;
  console.log('Triggers:', triggers);
}

main().catch(console.error).finally(() => prisma.$disconnect());
