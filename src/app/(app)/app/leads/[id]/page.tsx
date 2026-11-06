import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  ExternalLink,
  Phone,
  Sparkles,
  Trash2,
  UserCheck,
  UserPlus,
} from "lucide-react";
import { db } from "@/lib/db";
import { requireTenantPermission } from "@/lib/rbac";
import { hasTenantPermission, isStaffMember } from "@/lib/auth";
import {
  deleteLeadAction,
  updateLeadAction,
  logLeadActivityAction,
  convertLeadAction,
} from "@/actions/leads";
import { ActionForm } from "@/components/ui/action-form";
import { ConfirmButton } from "@/components/ui/client-bits";
import {
  Badge,
  Card,
  CardHeader,
  PageHeader,
  Tone,
} from "@/components/ui/primitives";
import { Field, FormGrid } from "@/components/ui/form-field";
import { LeadAiReplyDraft } from "@/components/app/lead-ai-reply";
import { date, timeAgo } from "@/lib/format";
import type { LeadStatus } from "@prisma/client";

export const metadata = { title: "Lead Details" };

function leadStatusTone(status: LeadStatus): Tone {
  switch (status) {
    case "CONVERTED":
      return "success";
    case "INTERESTED":
      return "brand";
    case "FOLLOW_UP":
      return "warning";
    case "CONTACTED":
      return "info";
    case "NEW":
      return "neutral";
    case "LOST":
      return "danger";
    default:
      return "neutral";
  }
}

export default async function LeadDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string; error?: string }>;
}) {
  const ctx = await requireTenantPermission("tenant.leads.read");
  if (!isStaffMember(ctx)) redirect("/portal");

  const { id } = await params;
  const sp = await searchParams;

  const lead = await db.lead.findFirst({
    where: { id, tenantId: ctx.tenant.id },
    include: {
      assignedTo: { include: { user: true } },
      academicYear: true,
      convertedStudent: {
        include: { section: { include: { class: true } } },
      },
      activities: {
        include: { actor: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!lead) notFound();

  const canWrite = hasTenantPermission(ctx, "tenant.leads.write");
  const canConvert = hasTenantPermission(ctx, "tenant.leads.convert");
  const canDelete = hasTenantPermission(ctx, "tenant.leads.delete");

  const [classes, sections, staff, academicYears] = await Promise.all([
    db.classLevel.findMany({
      where: { tenantId: ctx.tenant.id },
      orderBy: { order: "asc" },
    }),
    db.section.findMany({
      where: { tenantId: ctx.tenant.id },
      include: { class: true },
      orderBy: [{ class: { order: "asc" } }, { name: "asc" }],
    }),
    db.membership.findMany({
      where: { tenantId: ctx.tenant.id, status: "ACTIVE" },
      include: { user: true },
      orderBy: { user: { name: "asc" } },
    }),
    db.academicYear.findMany({
      where: { tenantId: ctx.tenant.id },
      orderBy: { startDate: "desc" },
    }),
  ]);

  const nameParts = lead.studentName.trim().split(/\s+/);
  const firstName = nameParts[0] ?? "";
  const lastName = nameParts.slice(1).join(" ") || "—";
  const isConverted = lead.status === "CONVERTED" || !!lead.convertedStudentId;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/app/leads"
          className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-[var(--text)]"
        >
          <ArrowLeft className="size-3.5" /> Back to leads
        </Link>
        {canDelete && !isConverted ? (
          <form action={deleteLeadAction}>
            <input type="hidden" name="leadId" value={lead.id} />
            <ConfirmButton
              className="btn btn-danger btn-sm"
              message="Delete this enquiry record?"
            >
              <Trash2 className="size-3.5" /> Delete lead
            </ConfirmButton>
          </form>
        ) : null}
      </div>

      {sp.error ? (
        <div className="rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] p-3.5 text-xs text-[var(--danger)]">
          {sp.error}
        </div>
      ) : null}

      <PageHeader
        eyebrow="Admissions CRM"
        title={lead.studentName}
        description={`Enquiry received on ${date(lead.createdAt)}. Current status: ${lead.status.replace("_", " ")}.`}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={leadStatusTone(lead.status)} className="text-xs px-2.5 py-1">
              {lead.status.replace("_", " ")}
            </Badge>
            {isConverted && lead.convertedStudent ? (
              <Link
                href={`/app/students/${lead.convertedStudent.id}`}
                className="btn btn-primary btn-sm gap-1.5"
              >
                <UserCheck className="size-3.5" /> View Student Profile <ExternalLink className="size-3" />
              </Link>
            ) : null}
          </div>
        }
      />

      {isConverted && lead.convertedStudent ? (
        <div className="rounded-xl border border-[var(--success)] bg-[var(--success-soft)] p-4 flex items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-[var(--success)] flex items-center gap-2">
              <CheckCircle2 className="size-4" /> This lead was converted to an enrolled student.
            </p>
            <p className="text-xs text-muted">
              Student: <strong>{lead.convertedStudent.firstName} {lead.convertedStudent.lastName}</strong> · Admission No: <strong>{lead.convertedStudent.admissionNo}</strong> · Class: <strong>{lead.convertedStudent.section?.class.name ?? "—"} ({lead.convertedStudent.section?.name ?? "—"})</strong>
            </p>
          </div>
          <Link
            href={`/app/students/${lead.convertedStudent.id}`}
            className="btn btn-secondary btn-sm shrink-0"
          >
            Open Student Profile →
          </Link>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column (2 cols) */}
        <div className="space-y-6 lg:col-span-2">
          {/* Lead Information Card */}
          <Card>
            <CardHeader
              title="Prospect Details"
              description="Student, guardian and academic intake specifications"
            />
            <div className="p-6">
              {canWrite && !isConverted ? (
                <ActionForm
                  action={updateLeadAction}
                  submitLabel="Save changes"
                  pendingLabel="Saving changes…"
                >
                  <input type="hidden" name="leadId" value={lead.id} />
                  <FormGrid>
                    <Field label="Student full name *">
                      <input
                        name="studentName"
                        defaultValue={lead.studentName}
                        required
                        className="input"
                      />
                    </Field>
                    <Field label="Date of birth">
                      <input
                        name="dob"
                        type="date"
                        defaultValue={lead.dob ? lead.dob.toISOString().slice(0, 10) : ""}
                        className="input"
                      />
                    </Field>
                    <Field label="Guardian name *">
                      <input
                        name="guardianName"
                        defaultValue={lead.guardianName}
                        required
                        className="input"
                      />
                    </Field>
                    <Field label="Guardian phone *">
                      <input
                        name="guardianPhone"
                        defaultValue={lead.guardianPhone}
                        required
                        className="input"
                      />
                    </Field>
                    <Field label="Guardian email">
                      <input
                        name="guardianEmail"
                        type="email"
                        defaultValue={lead.guardianEmail ?? ""}
                        className="input"
                      />
                    </Field>
                    <Field label="Interested class">
                      <select
                        name="classInterested"
                        defaultValue={lead.classInterested ?? ""}
                        className="select"
                      >
                        <option value="">Select class level…</option>
                        {classes.map((c) => (
                          <option key={c.id} value={c.name}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Academic year">
                      <select
                        name="academicYearId"
                        defaultValue={lead.academicYearId ?? ""}
                        className="select"
                      >
                        <option value="">Select academic year…</option>
                        {academicYears.map((ay) => (
                          <option key={ay.id} value={ay.id}>
                            {ay.name} {ay.isActive ? "(Current)" : ""}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Source">
                      <select name="source" defaultValue={lead.source} className="select">
                        <option value="WALK_IN">Walk-in Visit</option>
                        <option value="PHONE">Phone Call</option>
                        <option value="WEBSITE">Website Form</option>
                        <option value="REFERRAL">Parent Referral</option>
                        <option value="SOCIAL">Social Media</option>
                      </select>
                    </Field>
                    <Field label="Enquiry status">
                      <select name="status" defaultValue={lead.status} className="select">
                        <option value="NEW">New</option>
                        <option value="CONTACTED">Contacted</option>
                        <option value="FOLLOW_UP">Follow-Up Required</option>
                        <option value="INTERESTED">Interested</option>
                        <option value="LOST">Lost / Not Proceeding</option>
                        {isConverted ? <option value="CONVERTED">Converted</option> : null}
                      </select>
                    </Field>
                    <Field label="Assigned staff member">
                      <select
                        name="assignedToId"
                        defaultValue={lead.assignedToId ?? ""}
                        className="select"
                      >
                        <option value="">Unassigned</option>
                        {staff.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.user.name} ({s.designation || "Staff"})
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Next follow-up date">
                      <input
                        name="nextFollowUp"
                        type="date"
                        defaultValue={
                          lead.nextFollowUp ? lead.nextFollowUp.toISOString().slice(0, 10) : ""
                        }
                        className="input"
                      />
                    </Field>
                    <Field label="Enquiry notes" className="sm:col-span-2">
                      <textarea
                        name="notes"
                        defaultValue={lead.notes ?? ""}
                        rows={3}
                        className="textarea"
                      />
                    </Field>
                  </FormGrid>
                </ActionForm>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 text-xs">
                  <div>
                    <span className="text-muted block">Student Name</span>
                    <span className="font-semibold text-sm">{lead.studentName}</span>
                  </div>
                  <div>
                    <span className="text-muted block">Guardian</span>
                    <span className="font-medium">{lead.guardianName} ({lead.guardianPhone})</span>
                  </div>
                  <div>
                    <span className="text-muted block">Interested In</span>
                    <span>{lead.classInterested || "Not specified"}</span>
                  </div>
                  <div>
                    <span className="text-muted block">Source</span>
                    <span className="capitalize">{lead.source.toLowerCase().replace("_", " ")}</span>
                  </div>
                  <div>
                    <span className="text-muted block">Assigned Staff</span>
                    <span>{lead.assignedTo?.user.name ?? "Unassigned"}</span>
                  </div>
                  <div>
                    <span className="text-muted block">Next Follow-Up</span>
                    <span>{date(lead.nextFollowUp)}</span>
                  </div>
                  {lead.notes ? (
                    <div className="sm:col-span-2 pt-2 border-t border-[var(--border)]">
                      <span className="text-muted block">Notes</span>
                      <p className="mt-1">{lead.notes}</p>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </Card>

          {/* AI Enquiry Assistant */}
          <Card>
            <CardHeader
              title="AI Enquiry Assistant"
              description="Draft a warm, comprehensive enquiry reply with fee checklists and visit hours."
              action={<Sparkles className="size-4 text-[var(--brand)]" />}
            />
            <div className="p-6">
              <LeadAiReplyDraft leadId={lead.id} />
            </div>
          </Card>

          {/* Convert to Student Section */}
          {canConvert && !isConverted ? (
            <Card className="border-[var(--brand-soft)] shadow-sm">
              <CardHeader
                title="Convert Enquiry into Enrolled Student"
                description="Promote this enquiry into an official student admission. Enforces plan quota, deduplicates guardian records, and maintains traceable linkage."
                action={<UserPlus className="size-4 text-[var(--brand)]" />}
              />
              <div className="p-6">
                <ActionForm
                  action={convertLeadAction}
                  submitLabel="Confirm & Convert to Student"
                  pendingLabel="Converting to student…"
                >
                  <input type="hidden" name="leadId" value={lead.id} />
                  <FormGrid>
                    <Field label="Admission number *">
                      <input
                        name="admissionNo"
                        required
                        placeholder="e.g. ADM-2026-001"
                        className="input"
                      />
                    </Field>
                    <Field label="First name *">
                      <input
                        name="firstName"
                        defaultValue={firstName}
                        required
                        className="input"
                      />
                    </Field>
                    <Field label="Last name *">
                      <input
                        name="lastName"
                        defaultValue={lastName}
                        required
                        className="input"
                      />
                    </Field>
                    <Field label="Date of birth">
                      <input
                        name="dob"
                        type="date"
                        defaultValue={lead.dob ? lead.dob.toISOString().slice(0, 10) : ""}
                        className="input"
                      />
                    </Field>
                    <Field label="Gender">
                      <select name="gender" className="select" defaultValue="">
                        <option value="">Select gender…</option>
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                        <option value="Other">Other</option>
                      </select>
                    </Field>
                    <Field label="Class level">
                      <select name="classId" className="select" defaultValue="">
                        <option value="">Select class…</option>
                        {classes.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Section">
                      <select name="sectionId" className="select" defaultValue="">
                        <option value="">Select section…</option>
                        {sections.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.class.name} — Section {s.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Residential address" className="sm:col-span-2">
                      <input
                        name="address"
                        placeholder="e.g. 124 Park Avenue, South Extension"
                        className="input"
                      />
                    </Field>
                  </FormGrid>
                </ActionForm>
              </div>
            </Card>
          ) : null}
        </div>

        {/* Right Column: Activity Timeline */}
        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Log Follow-Up & Call Notes"
              description="Record parent calls, campus visits, or schedule next actions"
              action={<Phone className="size-4 text-muted" />}
            />
            <div className="p-4">
              <ActionForm
                action={logLeadActivityAction}
                submitLabel="Log activity"
                pendingLabel="Logging…"
              >
                <input type="hidden" name="leadId" value={lead.id} />
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-medium text-muted block mb-1">Activity type</label>
                    <select name="action" className="select text-xs" defaultValue="CALL">
                      <option value="CALL">Phone Call</option>
                      <option value="NOTE">General Note</option>
                      <option value="VISIT">Campus Visit</option>
                      <option value="FOLLOW_UP">Follow-Up Scheduled</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted block mb-1">Notes *</label>
                    <textarea
                      name="notes"
                      required
                      rows={2}
                      placeholder="e.g. Called parent. They are visiting on Friday for Class 8 seat availability."
                      className="textarea text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted block mb-1">Update next follow-up date</label>
                    <input name="nextFollowUp" type="date" className="input text-xs" />
                  </div>
                </div>
              </ActionForm>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Activity Timeline"
              description={`History of ${lead.activities.length} interactions`}
              action={<Clock className="size-4 text-muted" />}
            />
            <div className="divide-y divide-[var(--border)] max-h-[500px] overflow-y-auto">
              {lead.activities.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted">No activities logged yet.</div>
              ) : (
                lead.activities.map((act) => (
                  <div key={act.id} className="p-3 text-xs space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <Badge tone={act.action === "CONVERTED" ? "success" : "neutral"} className="text-[10px]">
                        {act.action}
                      </Badge>
                      <span className="text-[10px] text-muted">{timeAgo(act.createdAt)}</span>
                    </div>
                    <p className="text-[var(--text)] text-xs leading-relaxed">{act.notes}</p>
                    <p className="text-[10px] text-muted">By {act.actor.name}</p>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
