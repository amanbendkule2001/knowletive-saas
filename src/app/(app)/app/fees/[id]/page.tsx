import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  BadgeCheck,
  CalendarClock,
  CheckCircle,
  CircleDollarSign,
  ExternalLink,
  Phone,
  QrCode,
  ReceiptText,
  Trash2,
  Wallet,
} from "lucide-react";
import { db } from "@/lib/db";
import { requireTenantPermission } from "@/lib/rbac";
import { hasTenantPermission } from "@/lib/auth";
import { hasFeature } from "@/lib/entitlements";
import {
  recordFeePaymentAction,
  waiveFeeInvoiceAction,
  verifyFeePaymentLinkAction,
} from "@/actions/operations";
import {
  allocateStudentCreditToInvoiceAction,
  reverseCreditAllocationAction,
} from "@/actions/credit-transfers";
import { getOrCreateFeePaymentLink } from "@/lib/payments";
import { ActionForm } from "@/components/ui/action-form";
import { ConfirmButton } from "@/components/ui/client-bits";
import { FeatureLocked } from "@/components/ui/feature-gate";
import { Field, FormGrid } from "@/components/ui/form-field";
import {
  Avatar,
  Badge,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  InfoRow,
  PageHeader,
  Progress,
  statusLabel,
  statusTone,
} from "@/components/ui/primitives";
import { date, money } from "@/lib/format";
import { resolveUserBranchScope } from "@/lib/branch";

export const metadata = { title: "Fee invoice" };

const METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  UPI: "UPI",
  CARD: "Card",
  BANK_TRANSFER: "Bank transfer",
  CHEQUE: "Cheque",
};

export default async function FeeInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const ctx = await requireTenantPermission("tenant.fees.read");
  const plan = ctx.tenant.subscription?.plan;
  if (!hasFeature(plan, "fees")) {
    return <FeatureLocked feature="fees" title="Fees & payments" />;
  }

  const { id } = await params;
  const sp = await searchParams;

  const invoice = await db.feeInvoice.findFirst({
    where: { id, tenantId: ctx.tenant.id },
    include: {
      student: {
        include: {
          section: { include: { class: true } },
          guardians: { include: { guardian: true }, orderBy: { isPrimary: "desc" } },
        },
      },
      payments: { orderBy: { paidAt: "desc" } },
      paymentAllocations: {
        include: {
          receipt: true,
          creditTransfer: true,
          reversals: { orderBy: { reversedAt: "desc" } },
        },
        orderBy: { allocatedAt: "desc" },
      },
    },
  });
  if (!invoice) notFound();

  const branchScope = await resolveUserBranchScope(ctx);
  const invoiceBranchId = invoice.branchId || invoice.student.branchId;
  if (branchScope.isBranchScoped) {
    if (!invoiceBranchId || !branchScope.allowedBranchIds.includes(invoiceBranchId)) {
      notFound();
    }
  }

  const creditAccount = await db.studentCreditAccount.findFirst({
    where: { tenantId: ctx.tenant.id, studentId: invoice.studentId },
  });

  const canWrite = hasTenantPermission(ctx, "tenant.fees.write");
  const canCollectOffline = hasTenantPermission(ctx, "tenant.fees.collect_offline");
  const canViewUtr =
    hasTenantPermission(ctx, "tenant.fees.utr.view") ||
    ctx.isOwnerView ||
    Boolean(ctx.membership?.isOwner);

  function maskPaymentReference(ref: string | null | undefined): string {
    if (!ref) return "—";
    const str = ref.trim();
    if (str.length <= 4) return "••••";
    const suffix = str.slice(-4);
    return `••••••••${suffix}`;
  }
  const canRecordPayment = canWrite || canCollectOffline;
  const outstanding = Math.max(0, invoice.amount - invoice.paidAmount);
  const settled = invoice.status === "PAID" || invoice.status === "WAIVED";
  const overdue = !settled && invoice.dueDate < new Date();
  const guardian = invoice.student.guardians[0]?.guardian;
  const balanceTone =
    invoice.status === "PAID"
      ? "success"
      : invoice.status === "WAIVED"
        ? "neutral"
        : overdue
          ? "danger"
          : "warning";

  let paymentLink = null;
  if (!settled && outstanding > 0) {
    try {
      const result = await getOrCreateFeePaymentLink(invoice.id, ctx.tenant.id);
      paymentLink = result.link;
    } catch {
      // ignore
    }
  }

  return (
    <div className="space-y-5">
      <Link
        href="/app/fees"
        className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-[var(--text)]"
      >
        <ArrowLeft className="size-3.5" /> All fee invoices
      </Link>

      {sp.created && (
        <Callout tone="success" title="Invoice created">
          The invoice is now visible to your accounts team. Record payments here as they arrive.
        </Callout>
      )}

      {paymentLink?.submittedAt && !settled && (
        <div className="card p-4 border-[var(--warning)] bg-[var(--surface)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Badge tone="warning">Verification Pending</Badge>
              <span className="text-xs font-semibold">Payment Proof Submitted</span>
            </div>
            <p className="text-xs text-muted mt-1">
              UTR / Reference: <strong className="font-mono text-foreground">{canViewUtr ? paymentLink.utrReference : maskPaymentReference(paymentLink.utrReference)}</strong>
              {paymentLink.payerName && ` · Paid by ${paymentLink.payerName}`}
              {paymentLink.payerNotes && ` (${paymentLink.payerNotes})`}
            </p>
          </div>
          {canWrite && (
            <form action={verifyFeePaymentLinkAction}>
              <input type="hidden" name="linkId" value={paymentLink.id} />
              <button className="btn btn-primary btn-sm" type="submit">
                <CheckCircle className="size-3.5" /> Verify & Settle
              </button>
            </form>
          )}
        </div>
      )}

      <PageHeader
        eyebrow="Fee invoice"
        title={invoice.title}
        description={`${invoice.number} · ${invoice.student.firstName} ${invoice.student.lastName} · issued ${date(invoice.issuedAt)}`}
        actions={
          <>
            <Badge tone={statusTone(invoice.status)}>{statusLabel(invoice.status)}</Badge>
            {paymentLink && (
              <a
                href={`/pay/${paymentLink.token}`}
                target="_blank"
                rel="noreferrer"
                className="btn btn-secondary"
                title="Open public UPI / Bank payment page for parents"
              >
                <QrCode className="size-3.5" /> Payment Link <ExternalLink className="size-3" />
              </a>
            )}
            {canWrite && !settled && (
              <>
                <a href="#record-payment" className="btn btn-primary">
                  <Wallet className="size-3.5" /> Record payment
                </a>
                <form action={waiveFeeInvoiceAction}>
                  <input type="hidden" name="invoiceId" value={invoice.id} />
                  <ConfirmButton
                    className="btn btn-danger-soft"
                    message={`Waive invoice ${invoice.number}? The outstanding ${money(outstanding)} will no longer be collected. This is recorded in the audit trail.`}
                  >
                    <Trash2 className="size-3.5" /> Waive
                  </ConfirmButton>
                </form>
              </>
            )}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Invoice summary"
              description="Amounts in Indian rupees, inclusive of any taxes configured by the institute."
              action={<ReceiptText className="size-4 text-[var(--muted)]" />}
            />
            <div className="grid gap-4 p-4 sm:grid-cols-3">
              <div className="rounded-xl bg-[var(--surface-2)] p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted">Invoice amount</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{money(invoice.amount)}</p>
              </div>
              <div className="rounded-xl bg-[var(--surface-2)] p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted">Paid</p>
                <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--success)]">
                  {money(invoice.paidAmount)}
                </p>
              </div>
              <div className="rounded-xl bg-[var(--surface-2)] p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted">Balance</p>
                <p
                  className={`mt-1 text-xl font-semibold tabular-nums ${
                    outstanding > 0 ? "text-[var(--danger)]" : "text-muted"
                  }`}
                >
                  {invoice.status === "WAIVED" ? "Waived" : money(outstanding)}
                </p>
              </div>
            </div>

            <div className="px-4 pb-4">
              <Progress
                value={invoice.paidAmount}
                max={invoice.amount || 1}
                tone={invoice.status === "PAID" ? "success" : overdue ? "danger" : "brand"}
              />
              <p className="mt-1.5 text-[11px] text-muted">
                {invoice.amount > 0
                  ? `${Math.round((invoice.paidAmount / invoice.amount) * 100)}% collected`
                  : "No amount due"}
                {invoice.paidAt ? ` · settled ${date(invoice.paidAt)}` : ""}
              </p>
            </div>

            <div className="divide-y divide-[var(--border)] border-t border-[var(--border)] px-4 py-1">
              <InfoRow label="Invoice number">
                <span className="font-mono text-[12px]">{invoice.number}</span>
              </InfoRow>
              <InfoRow label="Student">
                <Link href={`/app/students/${invoice.studentId}`} className="link">
                  {invoice.student.firstName} {invoice.student.lastName}
                </Link>
              </InfoRow>
              <InfoRow label="Class">
                {invoice.student.section
                  ? `${invoice.student.section.class.name} — ${invoice.student.section.name}`
                  : "Unassigned"}
              </InfoRow>
              <InfoRow label="Issued">{date(invoice.issuedAt)}</InfoRow>
              <InfoRow label="Due">
                <span className={overdue ? "text-[var(--danger)]" : ""}>
                  {date(invoice.dueDate)}
                  {overdue ? " · overdue" : ""}
                </span>
              </InfoRow>
              {invoice.notes && <InfoRow label="Notes">{invoice.notes}</InfoRow>}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Payment history"
              description={`${invoice.payments.length} payment${invoice.payments.length === 1 ? "" : "s"} recorded`}
            />
            {invoice.payments.length === 0 ? (
              <EmptyState
                title="No payments recorded"
                description="As soon as a payment is collected, it appears here with its reference and method."
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Method</th>
                      <th>Reference</th>
                      <th className="text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.payments.map((payment) => (
                      <tr key={payment.id}>
                        <td className="text-muted">{date(payment.paidAt)}</td>
                        <td>{METHOD_LABELS[payment.method] ?? payment.method}</td>
                        <td className="font-mono text-[11px] text-muted">
                          {canViewUtr ? (payment.reference ?? "—") : maskPaymentReference(payment.reference)}
                        </td>
                        <td className="text-right font-medium tabular-nums">
                          {money(payment.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {invoice.paymentAllocations && invoice.paymentAllocations.length > 0 && (
            <Card>
              <CardHeader
                title="Allocated student credit"
                description={`${invoice.paymentAllocations.length} credit allocation${invoice.paymentAllocations.length === 1 ? "" : "s"} applied`}
              />
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Provenance / Type</th>
                      <th>Receipt</th>
                      <th>Transfer Ref</th>
                      <th className="text-right">Amount</th>
                      <th className="text-right">Reversals</th>
                      {canWrite && <th className="text-right">Action</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.paymentAllocations.map((alloc) => {
                      const totalReversed = alloc.reversals.reduce((sum, r) => sum + r.amount, 0);
                      const netActive = alloc.amount - totalReversed;
                      return (
                        <tr key={alloc.id}>
                          <td className="text-muted">{date(alloc.allocatedAt)}</td>
                          <td>
                            <Badge tone={alloc.creditTransferId ? "brand" : "neutral"}>
                              {alloc.creditTransferId ? "Transferred Sibling Credit" : "Direct Student Receipt"}
                            </Badge>
                          </td>
                          <td className="font-mono text-[11px]">
                            {alloc.receipt?.receiptNumber ?? alloc.receiptId}
                          </td>
                          <td className="font-mono text-[11px] text-muted">
                            {alloc.creditTransfer?.transferNumber ?? "—"}
                          </td>
                          <td className="text-right font-medium tabular-nums">
                            {money(alloc.amount)}
                          </td>
                          <td className="text-right tabular-nums text-xs">
                            {totalReversed > 0 ? (
                              <span className="text-[var(--danger)]">-{money(totalReversed)}</span>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                          {canWrite && (
                            <td className="text-right">
                              {netActive > 0 ? (
                                <ActionForm
                                  action={reverseCreditAllocationAction}
                                  submitLabel="Reverse"
                                  pendingLabel="Reversing…"
                                >
                                  <input type="hidden" name="allocationId" value={alloc.id} />
                                  <input type="hidden" name="feeInvoiceId" value={invoice.id} />
                                  <input type="hidden" name="amountInPaise" value={netActive} />
                                  <input type="hidden" name="reason" value="Accountant manual correction" />
                                </ActionForm>
                              ) : (
                                <span className="text-xs text-muted">Reversed</span>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Student" description="Invoice recipient" />
            <div className="flex items-center gap-3 px-4 pt-4">
              <Avatar
                name={`${invoice.student.firstName} ${invoice.student.lastName}`}
                color={ctx.tenant.accentColor}
                size={44}
              />
              <div className="min-w-0">
                <Link
                  href={`/app/students/${invoice.studentId}`}
                  className="block truncate font-semibold hover:underline"
                >
                  {invoice.student.firstName} {invoice.student.lastName}
                </Link>
                <p className="truncate font-mono text-[10px] text-muted">
                  {invoice.student.admissionNo}
                </p>
              </div>
            </div>
            <div className="divide-y divide-[var(--border)] px-4 py-1">
              <InfoRow label="Class">
                {invoice.student.section
                  ? `${invoice.student.section.class.name} — ${invoice.student.section.name}`
                  : "—"}
              </InfoRow>
              {guardian && (
                <>
                  <InfoRow label="Guardian">{guardian.name}</InfoRow>
                  <InfoRow label="Phone">
                    <a href={`tel:${guardian.phone}`} className="inline-flex items-center gap-1 link">
                      <Phone className="size-3" /> {guardian.phone}
                    </a>
                  </InfoRow>
                </>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader
              title={settled ? "Invoice closed" : "Collect a payment"}
              description={
                settled
                  ? invoice.status === "WAIVED"
                    ? "This invoice was waived by the institute."
                    : "This invoice is fully paid. No balance remains."
                  : `Outstanding balance ${money(outstanding)}`
              }
              action={
                <Badge tone={balanceTone}>
                  {settled ? statusLabel(invoice.status) : money(outstanding)}
                </Badge>
              }
            />

            {settled ? (
              <div className="space-y-3 p-4">
                <Callout
                  tone={invoice.status === "PAID" ? "success" : "neutral"}
                  title={invoice.status === "PAID" ? "Fully settled" : "Waived"}
                  icon={
                    invoice.status === "PAID" ? (
                      <BadgeCheck className="size-4" />
                    ) : (
                      <CalendarClock className="size-4" />
                    )
                  }
                >
                  {invoice.status === "PAID"
                    ? `All ${money(invoice.amount)} has been collected and recorded against this invoice.`
                    : "No further payment is expected for this invoice. You can raise a new invoice if required."}
                </Callout>
                <Link href={`/app/fees/new?studentId=${invoice.studentId}`} className="btn btn-secondary w-full">
                  <CircleDollarSign className="size-3.5" /> Raise another invoice
                </Link>
              </div>
            ) : canRecordPayment ? (
              <div id="record-payment" className="p-4">
                <ActionForm
                  action={recordFeePaymentAction}
                  submitLabel="Record payment"
                  pendingLabel="Recording…"
                >
                  <input type="hidden" name="invoiceId" value={invoice.id} />
                  <FormGrid>
                    <Field
                      label="Amount (₹)"
                      htmlFor="amount"
                      required
                      hint={`Maximum ${money(outstanding)}`}
                    >
                      <input
                        id="amount"
                        name="amount"
                        type="number"
                        min={1}
                        step="0.01"
                        max={outstanding / 100}
                        defaultValue={(outstanding / 100).toFixed(2)}
                        className="input"
                        required
                      />
                    </Field>
                    <Field label="Method" htmlFor="method" required>
                      <select id="method" name="method" className="select" defaultValue={canWrite ? "UPI" : "CASH"}>
                        <option value="CASH">Cash</option>
                        <option value="CHEQUE">Cheque</option>
                        {canWrite && <option value="UPI">UPI</option>}
                        {canWrite && <option value="CARD">Card</option>}
                        {canWrite && <option value="BANK_TRANSFER">Bank transfer</option>}
                      </select>
                    </Field>
                  </FormGrid>
                  <Field
                    label="Reference"
                    htmlFor="reference"
                    hint="Receipt number, UPI reference or cheque number. Optional but recommended."
                  >
                    <input
                      id="reference"
                      name="reference"
                      className="input"
                      placeholder="RCPT-204512"
                      maxLength={80}
                    />
                  </Field>
                  <p className="text-[11px] text-muted">
                    Partial payments are supported. The invoice stays open until the balance reaches
                    zero.
                  </p>
                </ActionForm>
              </div>
            ) : (
              <div className="p-4 text-[12px] text-muted">
                You have read-only access to fees. Ask an institute admin for the Record fee payments
                permission.
              </div>
            )}
          </Card>

          {!settled && canWrite && creditAccount && creditAccount.balance > 0 && (
            <Card>
              <CardHeader
                title="Apply student credit"
                description={`Available credit balance ${money(creditAccount.balance)}`}
                action={<Badge tone="brand">{money(creditAccount.balance)} available</Badge>}
              />
              <div className="p-4">
                <ActionForm
                  action={allocateStudentCreditToInvoiceAction}
                  submitLabel="Apply credit"
                  pendingLabel="Applying…"
                >
                  <input type="hidden" name="feeInvoiceId" value={invoice.id} />
                  <input type="hidden" name="studentId" value={invoice.studentId} />
                  <FormGrid>
                    <Field
                      label="Amount (₹)"
                      htmlFor="credit-amount"
                      required
                      hint={`Max payable ${money(Math.min(outstanding, creditAccount.balance))}`}
                    >
                      <input
                        id="credit-amount"
                        name="amount"
                        type="number"
                        min={1}
                        step="0.01"
                        max={Math.min(outstanding, creditAccount.balance) / 100}
                        defaultValue={(Math.min(outstanding, creditAccount.balance) / 100).toFixed(2)}
                        className="input"
                        required
                      />
                    </Field>
                    <Field label="Drawdown source" htmlFor="sourcePreference">
                      <select id="sourcePreference" name="sourcePreference" className="select" defaultValue="AUTO_FIFO">
                        <option value="AUTO_FIFO">Auto FIFO (Earliest receipt first)</option>
                        <option value="DIRECT_FIRST">Direct receipts first</option>
                        <option value="TRANSFERRED_FIRST">Transferred sibling credit first</option>
                      </select>
                    </Field>
                  </FormGrid>
                  <p className="text-[11px] text-muted">
                    Draws down available credit from student receipts and sibling transfers under strict
                    double-entry ledger rules without double-spending.
                  </p>
                </ActionForm>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
