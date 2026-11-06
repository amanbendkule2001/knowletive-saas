import Link from "next/link";
import { ArrowLeft, UserPlus } from "lucide-react";
import { db } from "@/lib/db";
import { requireTenantWrite } from "@/lib/rbac";
import { createLeadAction } from "@/actions/leads";
import { ActionForm } from "@/components/ui/action-form";
import { Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Field, FormGrid } from "@/components/ui/form-field";

export const metadata = { title: "New Enquiry" };

export default async function NewLeadPage() {
  const ctx = await requireTenantWrite("tenant.leads.write");

  const [classes, academicYears, staff] = await Promise.all([
    db.classLevel.findMany({
      where: { tenantId: ctx.tenant.id },
      orderBy: { order: "asc" },
    }),
    db.academicYear.findMany({
      where: { tenantId: ctx.tenant.id },
      orderBy: { startDate: "desc" },
    }),
    db.membership.findMany({
      where: { tenantId: ctx.tenant.id, status: "ACTIVE" },
      include: { user: true },
      orderBy: { user: { name: "asc" } },
    }),
  ]);

  return (
    <div className="space-y-6">
      <Link
        href="/app/leads"
        className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-[var(--text)]"
      >
        <ArrowLeft className="size-3.5" /> All enquiries
      </Link>

      <PageHeader
        eyebrow="Admissions CRM"
        title="Record new enquiry"
        description={`Record prospective student enquiry details for ${ctx.tenant.name}.`}
      />

      <Card className="mx-auto max-w-3xl">
        <CardHeader
          title="Prospect & Guardian Details"
          description="Fields marked with * are required. You can schedule follow-up dates and assign staff immediately."
          action={<UserPlus className="size-4 text-[var(--brand)]" />}
        />
        <div className="p-6">
          <ActionForm
            action={createLeadAction}
            submitLabel="Save enquiry"
            pendingLabel="Saving enquiry…"
            cancelHref="/app/leads"
          >
            <div className="space-y-6">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">
                  Student Information
                </h3>
                <FormGrid>
                  <Field label="Student full name *">
                    <input
                      name="studentName"
                      required
                      placeholder="e.g. Aarav Sharma"
                      className="input"
                    />
                  </Field>
                  <Field label="Date of birth">
                    <input name="dob" type="date" className="input" />
                  </Field>
                  <Field label="Interested in class">
                    <select name="classInterested" className="select" defaultValue="">
                      <option value="">Select class level…</option>
                      {classes.map((c) => (
                        <option key={c.id} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Academic year">
                    <select name="academicYearId" className="select" defaultValue="">
                      <option value="">Select academic year…</option>
                      {academicYears.map((ay) => (
                        <option key={ay.id} value={ay.id}>
                          {ay.name} {ay.isActive ? "(Current)" : ""}
                        </option>
                      ))}
                    </select>
                  </Field>
                </FormGrid>
              </div>

              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">
                  Guardian Contact
                </h3>
                <FormGrid>
                  <Field label="Guardian name *">
                    <input
                      name="guardianName"
                      required
                      placeholder="e.g. Rajesh Sharma"
                      className="input"
                    />
                  </Field>
                  <Field label="Guardian phone number *">
                    <input
                      name="guardianPhone"
                      required
                      placeholder="e.g. +91 98765 43210"
                      className="input"
                    />
                  </Field>
                  <Field label="Guardian email address">
                    <input
                      name="guardianEmail"
                      type="email"
                      placeholder="e.g. parent@example.com"
                      className="input"
                    />
                  </Field>
                  <Field label="Enquiry source">
                    <select name="source" className="select" defaultValue="WALK_IN">
                      <option value="WALK_IN">Walk-in Visit</option>
                      <option value="PHONE">Phone Call</option>
                      <option value="WEBSITE">Website Form</option>
                      <option value="REFERRAL">Parent Referral</option>
                      <option value="SOCIAL">Social Media</option>
                    </select>
                  </Field>
                </FormGrid>
              </div>

              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">
                  Follow-Up & Assignment
                </h3>
                <FormGrid>
                  <Field label="Assign staff member">
                    <select name="assignedToId" className="select" defaultValue="">
                      <option value="">Unassigned</option>
                      {staff.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.user.name} ({s.designation || "Staff"})
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Next follow-up date">
                    <input name="nextFollowUp" type="date" className="input" />
                  </Field>
                  <Field label="Initial enquiry notes" className="sm:col-span-2">
                    <textarea
                      name="notes"
                      rows={3}
                      placeholder="Enter parent requirements, previous school background, questions asked about fee structure, etc."
                      className="textarea"
                    />
                  </Field>
                </FormGrid>
              </div>
            </div>
          </ActionForm>
        </div>
      </Card>
    </div>
  );
}
