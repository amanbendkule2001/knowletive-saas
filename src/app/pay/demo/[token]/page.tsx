import { notFound } from "next/navigation";
import { createHash } from "node:crypto";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { JodoDemoCheckout } from "@/components/checkout/jodo-demo-checkout";

export const metadata = { title: "Jodo Demo Payment Checkout" };

export default async function DemoPayPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!token) notFound();

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const session = await db.demoPaymentSession.findFirst({
    where: {
      OR: [
        { tokenHash },
        { sessionToken: token },
      ],
    },
    include: {
      tenant: { select: { id: true, name: true, slug: true } },
      student: {
        include: {
          section: { include: { class: true } },
          branch: true,
        },
      },
      transactions: {
        where: { status: "SUCCESS" },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (!session) notFound();

  const studentName = `${session.student.firstName} ${session.student.lastName}`;
  const className = session.student.section?.class?.name ?? "Class";
  const sectionName = session.student.section?.name ? ` - ${session.student.section.name}` : "";
  const branchName = session.student.branch?.name ?? "Main Campus";

  // Generate dynamic UPI QR Code URL for the checkout experience
  const amountRupees = (session.amount / 100).toFixed(2);
  const upiUri = `upi://pay?pa=jodo.sunrise@hdfcbank&pn=${encodeURIComponent(
    session.tenant.name
  )}&am=${amountRupees}&cu=INR&tn=${encodeURIComponent(
    `Fee Payment - ${studentName} (${session.student.admissionNo})`
  )}`;
  const upiQrDataUrl = await QRCode.toDataURL(upiUri, { width: 220, margin: 1 });

  // Optional: fetch installment title if available
  let installmentTitle = "Tuition Fee Installment";
  if (session.installmentIds && Array.isArray(session.installmentIds) && session.installmentIds.length > 0) {
    const firstInstId = session.installmentIds[0] as string;
    const inst = await db.demoFeeInstallment.findUnique({
      where: { id: firstInstId },
      select: { title: true },
    });
    if (inst) installmentTitle = inst.title;
  }

  const existingTx = session.transactions[0]
    ? {
        reference: session.transactions[0].reference || "JODO-DEMO-UTR",
        amount: session.transactions[0].amount,
        createdAt: session.transactions[0].createdAt,
      }
    : null;

  return (
    <JodoDemoCheckout
      sessionToken={token}
      amountPaise={session.amount}
      studentName={studentName}
      admissionNo={session.student.admissionNo}
      className={className}
      sectionName={sectionName}
      tenantName={session.tenant.name}
      branchName={branchName}
      expiresAt={session.expiresAt}
      initialStatus={session.status}
      existingTransaction={existingTx}
      upiQrDataUrl={upiQrDataUrl}
      installmentTitle={installmentTitle}
    />
  );
}
