import Link from "next/link";
import { ArrowLeft, Calendar, GraduationCap, Layers, ReceiptText, Sparkles, Wallet } from "lucide-react";
import { db } from "@/lib/db";
import { requireTenantWrite } from "@/lib/rbac";
import { hasFeature } from "@/lib/entitlements";
import { createFeeInvoiceAction } from "@/actions/operations";
import { createStudentFeePlanAction } from "@/actions/installments";
import { ActionForm } from "@/components/ui/action-form";
import { FeatureLocked } from "@/components/ui/feature-gate";
import { Field, FormGrid, FormIntro } from "@/components/ui/form-field";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  StatCard,
} from "@/components/ui/primitives";
import { addDays, isoDate, money } from "@/lib/format";

export const metadata = { title: "New fee invoice or plan" };

export default async function NewFeeInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ studentId?: string; mode?: string }>;
}) {
  const ctx = await requireTenantWrite("tenant.fees.write");
  const plan = ctx.tenant.subscription?.plan;
  if (!hasFeature(plan, "fees")) {
    return <FeatureLocked feature="fees" title="Fees & payments" />;
  }

  const sp = await searchParams;
  const isPlanMode = sp.mode === "plan";
  const [students, openInvoices] = await Promise.all([
    db.student.findMany({
      where: { tenantId: ctx.tenant.id, status: "ACTIVE" },
      include: { section: { include: { class: true } } },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      take: 1000,
    }),
    db.feeInvoice.aggregate({
      where: { tenantId: ctx.tenant.id, status: { in: ["PENDING", "PARTIAL", "OVERDUE"] } },
      _sum: { amount: true, paidAmount: true },
      _count: { _all: true },
    }),
  ]);

  const selected = students.find((student) => student.id === sp.studentId);
  const outstanding = Math.max(
    0,
    (openInvoices._sum.amount ?? 0) - (openInvoices._sum.paidAmount ?? 0),
  );

  return (
    <div className="space-y-5">
      <Link
        href="/app/fees"
        className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-[var(--text)]"
      >
        <ArrowLeft className="size-3.5" /> All fee invoices
      </Link>

      <PageHeader
        eyebrow="Operations"
        title={isPlanMode ? "Create an Installment Schedule Plan" : "Raise a fee invoice"}
        description={
          isPlanMode
            ? `Configure term-wise scheduled fee installments for ${selected ? `${selected.firstName} ${selected.lastName}` : "a student"} with Jodo sandbox checkout integration.`
            : `Create an invoice for ${selected ? `${selected.firstName} ${selected.lastName}` : "a student"} in ${ctx.tenant.name}. Invoice numbers are generated automatically.`
        }
      />

      {/* Switcher Tabs */}
      <div className="flex items-center gap-2 border-b border-[var(--border)] pb-3">
        <Link
          href={`/app/fees/new?mode=single${sp.studentId ? `&studentId=${sp.studentId}` : ""}`}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
            !isPlanMode
              ? "bg-[var(--brand)] text-white shadow-xs"
              : "text-muted hover:bg-[var(--surface-2)] hover:text-foreground"
          }`}
        >
          <ReceiptText className="size-3.5" /> Single Invoice
        </Link>
        <Link
          href={`/app/fees/new?mode=plan${sp.studentId ? `&studentId=${sp.studentId}` : ""}`}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
            isPlanMode
              ? "bg-[var(--brand)] text-white shadow-xs"
              : "text-muted hover:bg-[var(--surface-2)] hover:text-foreground"
          }`}
        >
          <Layers className="size-3.5" /> Installment Schedule Plan (Jodo Sandbox)
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="Active students"
          value={students.length}
          sub="eligible for invoicing"
          icon={<GraduationCap className="size-4" />}
        />
        <StatCard
          label="Open invoices"
          value={openInvoices._count._all}
          sub="pending, partial or overdue"
          icon={<ReceiptText className="size-4" />}
          tone="warning"
        />
        <StatCard
          label="Outstanding"
          value={money(outstanding)}
          sub="across open invoices"
          icon={<Wallet className="size-4" />}
          tone={outstanding > 0 ? "danger" : "success"}
        />
      </div>

      {students.length === 0 ? (
        <Card>
          <EmptyState
            title="Add a student first"
            description="Fee invoices are always linked to a student record. Add an active student, then raise the invoice."
            action={
              <Link href="/app/students/new" className="btn btn-primary btn-sm">
                Add student
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
          {isPlanMode ? (
            <Card>
              <CardHeader
                title="Installment Plan Details"
                description="Configure scheduled term/quarter installments. Amounts are automatically divided."
              />
              <div className="p-4">
                <ActionForm
                  action={createStudentFeePlanAction}
                  submitLabel="Create Installment Plan"
                  pendingLabel="Generating schedule…"
                  cancelHref="/app/fees?tab=installments"
                >
                  <Field label="Student" htmlFor="studentId" required>
                    <select
                      id="studentId"
                      name="studentId"
                      className="select"
                      defaultValue={selected?.id ?? ""}
                      required
                    >
                      <option value="">Choose a student</option>
                      {students.map((student) => (
                        <option key={student.id} value={student.id}>
                          {student.firstName} {student.lastName} · {student.admissionNo}
                          {student.section
                            ? ` · ${student.section.class.name}-${student.section.name}`
                            : " · unassigned"}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field
                    label="Plan Title"
                    htmlFor="title"
                    required
                    hint="e.g. Annual Tuition Fee 2026-27 (Quarterly Installments)"
                  >
                    <input
                      id="title"
                      name="title"
                      className="input"
                      defaultValue="Annual Tuition Fee 2026-27 (Quarterly Installments)"
                      maxLength={120}
                      required
                    />
                  </Field>

                  <FormGrid>
                    <Field label="Total Annual Fee (₹)" htmlFor="totalAmount" required>
                      <input
                        id="totalAmount"
                        name="totalAmount"
                        type="number"
                        min={1}
                        step="0.01"
                        className="input"
                        placeholder="50000"
                        defaultValue="50000"
                        required
                      />
                    </Field>

                    <Field label="Concession / Discount (₹)" htmlFor="discountAmount">
                      <input
                        id="discountAmount"
                        name="discountAmount"
                        type="number"
                        min={0}
                        step="0.01"
                        className="input"
                        placeholder="0"
                        defaultValue="0"
                      />
                    </Field>

                    <Field label="Schedule Frequency" htmlFor="scheduleType" required>
                      <select id="scheduleType" name="scheduleType" className="select" defaultValue="QUARTERLY">
                        <option value="QUARTERLY">Quarterly (4 Quarters: Q1, Q2, Q3, Q4)</option>
                        <option value="MONTHLY">Monthly (10 Months)</option>
                        <option value="CUSTOM">Custom Term Schedule</option>
                      </select>
                    </Field>

                    <Field label="Number of Installments" htmlFor="installmentCount" required>
                      <input
                        id="installmentCount"
                        name="installmentCount"
                        type="number"
                        min={1}
                        max={12}
                        className="input"
                        defaultValue={4}
                        required
                      />
                    </Field>

                    <Field label="First Installment Due Date" htmlFor="startDate" required>
                      <input
                        id="startDate"
                        name="startDate"
                        type="date"
                        className="input"
                        defaultValue={isoDate(addDays(new Date(), 14))}
                        required
                      />
                    </Field>

                    <Field label="Accounts Notes" htmlFor="notes">
                      <input
                        id="notes"
                        name="notes"
                        className="input"
                        placeholder="Agreed quarterly plan with Jodo online checkout"
                        maxLength={240}
                      />
                    </Field>
                  </FormGrid>

                  <FormIntro
                    title="Automatic Backing Invoices"
                    description="When saved, the system automatically creates a StudentFeePlan along with dedicated backing FeeInvoices and StudentFeeInstallments for each period. Parents can view and settle each installment in Jodo checkout."
                  />
                </ActionForm>
              </div>
            </Card>
          ) : (
            <Card>
              <CardHeader
                title="Invoice details"
                description="Amounts are entered in rupees and stored safely in paise."
              />
              <div className="p-4">
                <ActionForm
                  action={createFeeInvoiceAction}
                  submitLabel="Create invoice"
                  pendingLabel="Creating…"
                  cancelHref="/app/fees"
                >
                  <Field label="Student" htmlFor="studentId" required>
                    <select
                      id="studentId"
                      name="studentId"
                      className="select"
                      defaultValue={selected?.id ?? ""}
                      required
                    >
                      <option value="">Choose a student</option>
                      {students.map((student) => (
                        <option key={student.id} value={student.id}>
                          {student.firstName} {student.lastName} · {student.admissionNo}
                          {student.section
                            ? ` · ${student.section.class.name}-${student.section.name}`
                            : " · unassigned"}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <FormGrid>
                    <Field
                      label="Invoice title"
                      htmlFor="title"
                      required
                      hint="e.g. Term 2 fees, Transport, Annual day"
                    >
                      <input
                        id="title"
                        name="title"
                        className="input"
                        placeholder="Term 2 fees"
                        maxLength={120}
                        required
                      />
                    </Field>
                    <Field label="Amount (₹)" htmlFor="amount" required>
                      <input
                        id="amount"
                        name="amount"
                        type="number"
                        min={1}
                        step="0.01"
                        className="input"
                        placeholder="12500"
                        required
                      />
                    </Field>
                    <Field
                      label="Due date"
                      htmlFor="dueDate"
                      required
                      hint="Invoices past their due date are marked overdue automatically."
                    >
                      <input
                        id="dueDate"
                        name="dueDate"
                        type="date"
                        className="input"
                        defaultValue={isoDate(addDays(new Date(), 14))}
                        required
                      />
                    </Field>
                    <Field label="Notes" htmlFor="notes" hint="Optional. Visible to your accounts team.">
                      <input
                        id="notes"
                        name="notes"
                        className="input"
                        placeholder="Instalment plan approved by accounts"
                        maxLength={240}
                      />
                    </Field>
                  </FormGrid>

                  <FormIntro
                    title="What happens when you save"
                    description="The invoice appears in the fees workspace immediately. You can record a full or partial payment from the invoice page, and the balance updates automatically."
                  />
                </ActionForm>
              </div>
            </Card>
          )}

          <div className="space-y-4">
            <Card>
              <CardHeader title="Fee workflow" description="Built for real front-office work" />
              <ol className="space-y-3 p-4 text-[12px] text-muted">
                {[
                  "Raise an invoice against the student record — the number is generated for you.",
                  "Record cash, UPI, card, cheque or bank transfer payments with a reference.",
                  "Partial payments keep the invoice open and show the exact balance due.",
                  "Waive an invoice only when the institute has approved it; the status change is audited.",
                ].map((step, index) => (
                  <li key={step} className="flex gap-2.5">
                    <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[var(--brand-soft)] text-[10px] font-semibold text-[var(--brand)]">
                      {index + 1}
                    </span>
                    <span className="leading-relaxed">{step}</span>
                  </li>
                ))}
              </ol>
            </Card>

            <Card>
              <CardHeader title="Need a different amount?" />
              <p className="p-4 text-[12px] leading-relaxed text-muted">
                Use one invoice per fee head (tuition, transport, exam) so parents see a clear
                breakdown. You can also split a term fee into instalments and collect them against
                the same invoice over time.
              </p>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
