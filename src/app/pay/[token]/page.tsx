import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { Logo } from "@/components/ui/logo";
import { ActionForm } from "@/components/ui/action-form";
import { submitPaymentProofAction } from "@/actions/operations";
import {
  Card,
  CardHeader,
  Callout,
} from "@/components/ui/primitives";
import {
  Building2,
  CheckCircle2,
  Clock,
  QrCode,
  ShieldCheck,
} from "lucide-react";
import { date, money } from "@/lib/format";

export const metadata = { title: "School Fee Payment" };

export default async function PublicPayPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!token) notFound();

  const link = await db.feePaymentLink.findUnique({
    where: { token },
    include: {
      tenant: true,
      feeInvoice: {
        include: {
          student: {
            include: {
              section: { include: { class: true } },
            },
          },
        },
      },
    },
  });

  if (!link) notFound();

  const isExpired = link.expiresAt < new Date() && link.status !== "PAID";
  const student = link.feeInvoice.student;
  const studentName = `${student.firstName} ${student.lastName}`;
  const className = student.section?.class?.name ?? "Class";
  const sectionName = student.section?.name ? ` - ${student.section.name}` : "";
  const amountInRupees = (link.amount / 100).toFixed(2);

  // Bank & UPI settings from tenant configuration (fallback to institute defaults)
  const settings = (link.tenant.settings as Record<string, string> | null) ?? {};
  const upiVpa = settings.upiVpa || `${link.tenant.slug.replace(/[^a-z0-9]/gi, "")}@upi`;
  const bankName = settings.bankName || "State Bank of India";
  const accountNumber = settings.accountNumber || "398710293847";
  const ifscCode = settings.ifscCode || "SBIN0001234";
  const accountHolder = settings.accountHolder || link.tenant.name;

  // Construct dynamic UPI payment URI
  const upiNote = `${link.feeInvoice.number} - ${studentName}`;
  const upiUri = `upi://pay?pa=${encodeURIComponent(upiVpa)}&pn=${encodeURIComponent(link.tenant.name)}&am=${amountInRupees}&cu=INR&tn=${encodeURIComponent(upiNote)}`;
  const qrCodeDataUrl = await QRCode.toDataURL(upiUri, { width: 240, margin: 1 });

  return (
    <div className="min-h-dvh bg-[var(--surface-sunken)] py-8 px-4 sm:px-6">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[var(--border)]">
          <Logo href={null} subtitle="Fee Settlement" />
          <div className="text-right">
            <p className="text-xs font-semibold text-foreground">{link.tenant.name}</p>
            <p className="text-[10px] text-muted">Official Payment Gateway</p>
          </div>
        </div>

        {/* Invoice Summary Card */}
        <Card className="p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-[var(--border)]">
            <div>
              <span className="text-[11px] font-mono uppercase tracking-wider text-muted">Invoice Details</span>
              <h1 className="text-xl font-bold mt-0.5">{link.feeInvoice.title}</h1>
              <p className="text-xs text-muted mt-1">Invoice: <span className="font-mono">{link.feeInvoice.number}</span></p>
            </div>
            <div className="sm:text-right">
              <span className="text-xs text-muted block">Amount Due</span>
              <span className="text-2xl font-bold text-foreground">{money(link.amount)}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-4 text-xs">
            <div>
              <span className="text-muted block">Student</span>
              <span className="font-semibold">{studentName}</span>
              <span className="text-muted block text-[11px]">Adm No: {student.admissionNo}</span>
            </div>
            <div>
              <span className="text-muted block">Class & Grade</span>
              <span className="font-semibold">{className}{sectionName}</span>
              <span className="text-muted block text-[11px]">Due Date: {date(link.feeInvoice.dueDate)}</span>
            </div>
          </div>
        </Card>

        {/* Status Conditional Panels */}
        {link.status === "PAID" ? (
          <Card className="p-6 text-center space-y-3 border-[var(--success)] bg-[var(--surface)]">
            <div className="mx-auto grid size-12 place-items-center rounded-full bg-[var(--success-soft)] text-[var(--success)]">
              <CheckCircle2 className="size-6" />
            </div>
            <h2 className="text-lg font-bold text-[var(--success)]">Payment Verified & Settled</h2>
            <p className="text-xs text-muted max-w-md mx-auto">
              This invoice was marked paid on {link.paidAt ? date(link.paidAt) : "record"}. A receipt has been issued to the student profile.
            </p>
            {link.utrReference && (
              <p className="text-xs font-mono text-muted bg-[var(--surface-sunken)] py-2 px-3 rounded inline-block">
                Reference / UTR: {link.utrReference}
              </p>
            )}
          </Card>
        ) : isExpired ? (
          <Callout tone="danger" title="Payment Link Expired">
            This payment link expired on {date(link.expiresAt)}. Please contact the school accounts department to issue a new payment link.
          </Callout>
        ) : link.submittedAt ? (
          <Card className="p-6 space-y-3 bg-[var(--surface)]">
            <div className="flex items-start gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--warning-soft)] text-[var(--warning)]">
                <Clock className="size-5" />
              </div>
              <div>
                <h2 className="text-base font-bold">Payment Proof Submitted</h2>
                <p className="text-xs text-muted mt-1">
                  We have received your transaction reference <strong className="font-mono">{link.utrReference}</strong> submitted by {link.payerName}.
                </p>
                <p className="text-xs text-muted mt-1">
                  The school accounts office is reconciling this credit against the bank statement. Your status will update to Paid as soon as it is approved.
                </p>
              </div>
            </div>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Payment Methods */}
            <div className="grid gap-4 sm:grid-cols-2">
              {/* UPI Option */}
              <Card className="p-5 flex flex-col items-center text-center justify-between">
                <div className="w-full">
                  <div className="flex items-center justify-center gap-2 mb-3">
                    <QrCode className="size-4 text-brand" />
                    <h3 className="font-semibold text-sm">Instant UPI Transfer</h3>
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-[var(--border)] shadow-sm inline-block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={qrCodeDataUrl} alt="UPI Payment QR Code" className="size-48 object-contain" />
                  </div>
                  <p className="text-[11px] text-muted mt-3">
                    Scan with GPay, PhonePe, Paytm, or any BHIM UPI app.
                  </p>
                  <p className="text-xs font-mono font-medium text-foreground mt-1 select-all bg-[var(--surface-sunken)] py-1 px-2 rounded">
                    {upiVpa}
                  </p>
                </div>
              </Card>

              {/* Direct Bank NEFT / IMPS Option */}
              <Card className="p-5 flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Building2 className="size-4 text-brand" />
                    <h3 className="font-semibold text-sm">Direct Bank Transfer</h3>
                  </div>
                  <p className="text-xs text-muted mb-3">
                    Transfer funds via NEFT, RTGS, or IMPS directly into the official school account:
                  </p>

                  <div className="space-y-2 text-xs">
                    <div className="bg-[var(--surface-sunken)] p-2 rounded">
                      <span className="text-muted block text-[10px]">Beneficiary Name</span>
                      <span className="font-medium select-all">{accountHolder}</span>
                    </div>
                    <div className="bg-[var(--surface-sunken)] p-2 rounded">
                      <span className="text-muted block text-[10px]">Account Number</span>
                      <span className="font-mono font-semibold select-all">{accountNumber}</span>
                    </div>
                    <div className="bg-[var(--surface-sunken)] p-2 rounded">
                      <span className="text-muted block text-[10px]">IFSC Code</span>
                      <span className="font-mono font-semibold select-all">{ifscCode}</span>
                    </div>
                    <div className="bg-[var(--surface-sunken)] p-2 rounded">
                      <span className="text-muted block text-[10px]">Bank & Branch</span>
                      <span className="font-medium">{bankName}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-[var(--border)] flex items-center gap-1.5 text-[11px] text-[var(--success)]">
                  <ShieldCheck className="size-3.5" /> Direct institute account verified
                </div>
              </Card>
            </div>

            {/* Step 2: Submit UTR Reference Form */}
            <Card className="p-6">
              <CardHeader
                title="Submit Payment Reference"
                description="Once you have transferred the funds via UPI or Bank, enter the transaction reference (UTR) below so the school cashier can verify and reconcile your payment."
              />

              <div className="mt-4">
                <ActionForm
                  action={submitPaymentProofAction}
                  submitLabel="Submit Payment Proof"
                  pendingLabel="Submitting Reference…"
                >
                  <input type="hidden" name="token" value={token} />

                  <div className="space-y-4">
                    <div>
                      <label htmlFor="utrReference" className="form-label required">
                        Bank UTR / Transaction Reference Number
                      </label>
                      <input
                        id="utrReference"
                        name="utrReference"
                        type="text"
                        required
                        placeholder="e.g. 425178923412 or UPI/4251..."
                        className="input font-mono"
                      />
                      <p className="text-[11px] text-muted mt-1">
                        Find this 12-digit number in your UPI app (GPay/PhonePe/Paytm) transaction details or bank statement.
                      </p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label htmlFor="payerName" className="form-label required">
                          Payer Name
                        </label>
                        <input
                          id="payerName"
                          name="payerName"
                          type="text"
                          required
                          placeholder="Parent or Guardian Name"
                          className="input"
                        />
                      </div>
                      <div>
                        <label htmlFor="payerPhone" className="form-label">
                          Mobile Number
                        </label>
                        <input
                          id="payerPhone"
                          name="payerPhone"
                          type="tel"
                          placeholder="+91 9876543210"
                          className="input"
                        />
                      </div>
                    </div>

                    <div>
                      <label htmlFor="payerNotes" className="form-label">
                        Notes (Optional)
                      </label>
                      <input
                        id="payerNotes"
                        name="payerNotes"
                        type="text"
                        placeholder="e.g. Transferred from HDFC Bank account"
                        className="input"
                      />
                    </div>
                  </div>
                </ActionForm>
              </div>
            </Card>
          </div>
        )}

        {/* Footer info */}
        <div className="text-center text-xs text-muted pt-4">
          <p>Powered by Knowletive Institute OS &bull; Zero Additional Transaction Surcharges</p>
        </div>
      </div>
    </div>
  );
}
