import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Building2,
  CheckCircle2,
  ChevronRight,
  Landmark,
  Plus,
  Power,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Users,
  Wallet,
} from "lucide-react";
import { db } from "@/lib/db";
import { requireTenantPermission } from "@/lib/rbac";
import { hasTenantPermission } from "@/lib/auth";
import {
  createBranchAction,
  activateBranchAction,
  archiveBranchAction,
} from "@/actions/branches";
import { ActionForm } from "@/components/ui/action-form";
import { Field, FormGrid, FormIntro } from "@/components/ui/form-field";
import {
  Badge,
  Card,
  CardHeader,
  PageHeader,
  StatCard,
} from "@/components/ui/primitives";

export const metadata = { title: "Branches & Campuses" };

export default async function BranchesPage() {
  const ctx = await requireTenantPermission("tenant.settings.read");
  const canManage = hasTenantPermission(ctx, "tenant.settings.manage");

  const branches = await db.branch.findMany({
    where: { tenantId: ctx.tenant.id },
    include: {
      parent: { select: { id: true, name: true, code: true } },
      _count: { select: { students: true, feeInvoices: true } },
    },
    orderBy: [{ branchType: "asc" }, { name: "asc" }],
  });

  const activeBranches = branches.filter((b) => b.isActive);
  const inactiveBranches = branches.filter((b) => !b.isActive);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Campuses & Branches"
        description={`Manage operational campuses, Jodo collector codes, and bank accounts for ${ctx.tenant.name}.`}
        actions={
          <Badge tone="brand">
            <Building2 className="size-3" /> Multi-Branch Architecture
          </Badge>
        }
      />

      {/* KPI Cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Total Branches"
          value={branches.length}
          sub="configured in institute"
          icon={<Building2 className="size-4" />}
        />
        <StatCard
          label="Active Campuses"
          value={activeBranches.length}
          sub="accepting admissions & fees"
          icon={<CheckCircle2 className="size-4" />}
          tone={activeBranches.length > 0 ? "success" : "danger"}
        />
        <StatCard
          label="Inactive / Archived"
          value={inactiveBranches.length}
          sub="temporarily deactivated"
          icon={<RotateCcw className="size-4" />}
          tone={inactiveBranches.length > 0 ? "warning" : "neutral"}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        {/* Left Column: Registered Branches List */}
        <div className="space-y-4">
          <Card className="p-6">
            <div className="flex items-center justify-between pb-4 border-b border-[var(--border)]">
              <div>
                <h3 className="text-base font-bold text-foreground">Registered Campuses</h3>
                <p className="text-xs text-muted mt-0.5">
                  Activate, configure, or archive campus entities.
                </p>
              </div>
              <Badge tone="neutral">{branches.length} Total</Badge>
            </div>

            {branches.length === 0 ? (
              <div className="py-12 text-center">
                <Building2 className="size-10 mx-auto text-muted mb-3 opacity-40" />
                <h4 className="text-sm font-semibold text-foreground">No branches found</h4>
                <p className="text-xs text-muted max-w-sm mx-auto mt-1">
                  Create your first main campus below to begin enrolling students and setting up fee collections.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--border)] mt-2">
                {branches.map((b) => (
                  <div
                    key={b.id}
                    className="py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-foreground text-sm">{b.name}</span>
                        <Badge tone={b.branchType === "MAIN" ? "brand" : "neutral"}>
                          {b.branchType}
                        </Badge>
                        <Badge tone={b.isActive ? "success" : "neutral"}>
                          {b.isActive ? "Active" : "Inactive"}
                        </Badge>
                        <span className="text-muted font-mono text-[11px]">[{b.code}]</span>
                      </div>

                      {b.parent && (
                        <p className="text-muted text-[11px]">
                          Parent Campus: <span className="font-medium text-foreground">{b.parent.name}</span>
                        </p>
                      )}

                      <p className="text-muted text-[11px]">
                        Jodo Collector Code:{" "}
                        <span className="font-mono font-medium text-foreground">
                          {b.collectorCode || "Not Configured"}
                        </span>{" "}
                        &bull; Students: <span className="font-medium text-foreground">{b._count.students}</span>
                        &bull; Invoices: <span className="font-medium text-foreground">{b._count.feeInvoices}</span>
                      </p>

                      {b.bankAccountNumber && (
                        <p className="text-[11px] text-muted">
                          Bank: <span className="font-medium text-foreground">{b.bankBankName || "Bank"}</span> &bull; A/C:{" "}
                          <span className="font-mono">{b.bankAccountNumber}</span> ({b.bankIfsc})
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {canManage && (
                        <>
                          {b.isActive ? (
                            <ActionForm
                              action={archiveBranchAction}
                              submitLabel="Archive"
                              pendingLabel="Archiving…"
                              variant="danger"
                            >
                              <input type="hidden" name="branchId" value={b.id} />
                            </ActionForm>
                          ) : (
                            <ActionForm
                              action={activateBranchAction}
                              submitLabel="Activate Branch"
                              pendingLabel="Activating…"
                            >
                              <input type="hidden" name="branchId" value={b.id} />
                            </ActionForm>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Right Column: Create Branch Form */}
        <div>
          <Card className="p-6">
            <div className="pb-4 border-b border-[var(--border)] mb-4">
              <h3 className="text-base font-bold text-foreground">Add New Campus</h3>
              <p className="text-xs text-muted mt-0.5">
                Register a new main campus or secondary branch.
              </p>
            </div>

            {canManage ? (
              <ActionForm
                action={createBranchAction}
                submitLabel="Create Branch"
                pendingLabel="Creating…"
              >
                <Field label="Branch Name" htmlFor="name" required hint="e.g. Sunrise North Campus">
                  <input
                    id="name"
                    name="name"
                    className="input"
                    placeholder="Sunrise North Campus"
                    required
                  />
                </Field>

                <FormGrid>
                  <Field label="Branch Code" htmlFor="code" required hint="e.g. NORTH, EAST">
                    <input
                      id="code"
                      name="code"
                      className="input uppercase font-mono"
                      placeholder="NORTH"
                      required
                    />
                  </Field>

                  <Field label="Branch Type" htmlFor="branchType" required>
                    <select id="branchType" name="branchType" className="select" defaultValue="MAIN">
                      <option value="MAIN">Main Campus (Independent)</option>
                      <option value="SUB_BRANCH">Sub-Branch (Subordinate)</option>
                    </select>
                  </Field>
                </FormGrid>

                {activeBranches.length > 0 && (
                  <Field
                    label="Parent Branch (for Sub-Branch)"
                    htmlFor="parentBranchId"
                    hint="Only required if Branch Type is Sub-Branch"
                  >
                    <select id="parentBranchId" name="parentBranchId" className="select" defaultValue="none">
                      <option value="none">None (Top Level)</option>
                      {activeBranches
                        .filter((b) => b.branchType === "MAIN")
                        .map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name} ({b.code})
                          </option>
                        ))}
                    </select>
                  </Field>
                )}

                <Field
                  label="Jodo Collector Code"
                  htmlFor="collectorCode"
                  hint="Collector routing code for Jodo multi-branch settlements (e.g. COL-SUN-NORTH)"
                >
                  <input
                    id="collectorCode"
                    name="collectorCode"
                    className="input font-mono"
                    placeholder="COL-SUN-NORTH"
                  />
                </Field>

                <FormIntro
                  title="Settlement Bank Account Details"
                  description="Where parent fees collected via Jodo will be settled by the platform."
                />

                <FormGrid>
                  <Field label="Account Holder Name" htmlFor="bankAccountName">
                    <input
                      id="bankAccountName"
                      name="bankAccountName"
                      className="input"
                      placeholder="Sunrise Public School North"
                    />
                  </Field>

                  <Field label="Bank Name" htmlFor="bankBankName">
                    <input
                      id="bankBankName"
                      name="bankBankName"
                      className="input"
                      placeholder="HDFC Bank"
                    />
                  </Field>

                  <Field label="Bank Account Number" htmlFor="bankAccountNumber">
                    <input
                      id="bankAccountNumber"
                      name="bankAccountNumber"
                      className="input font-mono"
                      placeholder="918273645012"
                    />
                  </Field>

                  <Field label="IFSC Code" htmlFor="bankIfsc">
                    <input
                      id="bankIfsc"
                      name="bankIfsc"
                      className="input uppercase font-mono"
                      placeholder="HDFC0001234"
                    />
                  </Field>
                </FormGrid>
              </ActionForm>
            ) : (
              <p className="text-xs text-muted">You do not have permission to manage branches.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
