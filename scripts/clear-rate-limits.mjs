import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const deleted = await prisma.rateLimitBucket.deleteMany({});
  console.log("Cleared rate limit buckets:", deleted.count);
}

main().catch(console.error).finally(() => prisma.$disconnect());

