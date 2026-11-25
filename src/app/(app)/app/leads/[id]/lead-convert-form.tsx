"use client";

import { useState } from "react";
import { UserPlus, Sparkles, BookOpen, Users, Receipt, Calendar, GraduationCap } from "lucide-react";
import { convertLeadAction } from "@/actions/leads";
import { ActionForm } from "@/components/ui/action-form";
import { Field, FormGrid, FormIntro } from "@/components/ui/form-field";

type ClassOption = { id: string; name: string };
type SectionOption = { id: string; name: string; classId: string; class: { name: string } };
type BatchOption = { id: string; name: string; code: string; capacity: number };
type SubjectOption = { id: string; name: string; code: string | null; classId: string | null };
type StaffOption = { id: string; user: { name: string; email: string }; role: { name: string } | null; designation?: string | null };

export function LeadConvertForm({
  leadId,
  suggestedAdmissionNo,
  defaultFirstName,
  defaultLastName,
  defaultDob,
  classes,
  sections,
  batches,
  subjects,
  staff,
}: {
  leadId: string;
  suggestedAdmissionNo: string;
  defaultFirstName: string;
  defaultLastName: string;
  defaultDob: string;
  classes: ClassOption[];
  sections: SectionOption[];
  batches: BatchOption[];
  subjects: SubjectOption[];
  staff: StaffOption[];
}) {
  const [selectedClassId, setSelectedClassId] = useState("");
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
  const [feeAmount, setFeeAmount] = useState<string>("");
  const [discountAmount, setDiscountAmount] = useState<string>("");

  const numFee = Math.max(0, Number(feeAmount) || 0);
  const numDiscount = Math.max(0, Number(discountAmount) || 0);
  const netPayable = Math.max(0, numFee - numDiscount);

  // Filter sections by selected class if one is picked
  const availableSections = selectedClassId
    ? sections.filter((s) => s.classId === selectedClassId)
    : sections;

  const toggleSubject = (id: string) => {
    setSelectedSubjects((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  return (
    <ActionForm
      action={convertLeadAction}
      submitLabel="Confirm & Convert to Student"
      pendingLabel="Converting to student…"
    >
      <input type="hidden" name="leadId" value={leadId} />

      {/* 1. Student Identity */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 border-b border-[var(--border)] pb-2 text-xs font-semibold uppercase tracking-wider text-muted">
          <GraduationCap className="size-4 text-[var(--brand)]" />
          <span>Student Demographics & Admission ID</span>
        </div>

        <FormGrid>
          <Field
            label="Admission number *"
            htmlFor="admissionNo"
            hint="Auto-generated suggestion. You can edit if your institute uses a custom format."
          >
            <input
              id="admissionNo"
              name="admissionNo"
              required
              defaultValue={suggestedAdmissionNo}
              placeholder="e.g. ADM-2026-001"
              className="input font-mono"
            />
          </Field>

          <Field label="First name *" htmlFor="firstName">
            <input
              id="firstName"
              name="firstName"
              defaultValue={defaultFirstName}
              required
              className="input"
            />
          </Field>

          <Field label="Last name *" htmlFor="lastName">
            <input
              id="lastName"
              name="lastName"
              defaultValue={defaultLastName}
              required
              className="input"
            />
          </Field>

          <Field label="Date of birth" htmlFor="dob">
            <input
              id="dob"
              name="dob"
              type="date"
              defaultValue={defaultDob}
              className="input"
            />
          </Field>

          <Field label="Gender" htmlFor="gender">
            <select id="gender" name="gender" className="select" defaultValue="">
              <option value="">Select gender…</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Other">Other</option>
            </select>
          </Field>

          <Field label="Residential address" htmlFor="address" className="sm:col-span-2">
            <input
              id="address"
              name="address"
              placeholder="e.g. 124 Park Avenue, South Extension"
              className="input"
            />
          </Field>
        </FormGrid>
      </div>

      {/* 2. Academic Placement (Class, Section, Batch, Teacher) */}
      <div className="space-y-4 pt-4 border-t border-[var(--border)]">
        <div className="flex items-center gap-2 border-b border-[var(--border)] pb-2 text-xs font-semibold uppercase tracking-wider text-muted">
          <BookOpen className="size-4 text-[var(--brand)]" />
          <span>Academic Allocation & Classroom Batch</span>
        </div>

        <FormGrid>
          <Field label="Class level" htmlFor="classId">
            <select
              id="classId"
              name="classId"
              className="select"
              value={selectedClassId}
              onChange={(e) => setSelectedClassId(e.target.value)}
            >
              <option value="">Select class…</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Section" htmlFor="sectionId">
            <select id="sectionId" name="sectionId" className="select" defaultValue="">
              <option value="">Select section…</option>
              {availableSections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.class.name} — Section {s.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Enroll in Batch" htmlFor="batchId" hint="Assigns student to active cohort roster">
            <select id="batchId" name="batchId" className="select" defaultValue="">
              <option value="">No batch (assign later)</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.code}) · Max {b.capacity}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Assigned Teacher / Mentor" htmlFor="teacherId" hint="Designates student's primary faculty guide">
            <select id="teacherId" name="teacherId" className="select" defaultValue="">
              <option value="">Unassigned</option>
              {staff.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.user.name} — {m.designation || m.role?.name || "Staff"}
                </option>
              ))}
            </select>
          </Field>
        </FormGrid>

        {/* Multiple Subjects Selection */}
        {subjects.length > 0 && (
          <div className="space-y-2 pt-2">
            <label className="text-xs font-medium text-[var(--text)]">
              Enrolled Subjects (Multiple Selection)
            </label>
            <div className="flex flex-wrap gap-2">
              {subjects.map((sub) => {
                const isChecked = selectedSubjects.includes(sub.id);
                return (
                  <label
                    key={sub.id}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs cursor-pointer transition-colors ${
                      isChecked
                        ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)] font-semibold"
                        : "border-[var(--border)] hover:bg-[var(--surface-2)] text-muted"
                    }`}
                  >
                    <input
                      type="checkbox"
                      name="subjectIds"
                      value={sub.id}
                      checked={isChecked}
                      onChange={() => toggleSubject(sub.id)}
                      className="size-3.5 rounded border-gray-300 text-[var(--brand)] focus:ring-[var(--brand)]"
                    />
                    <span>{sub.name}</span>
                    {sub.code && <span className="font-mono text-[10px] opacity-75">({sub.code})</span>}
                  </label>
                );
              })}
            </div>
            <p className="text-[11px] text-muted">Select all applicable subjects for this student&apos;s curriculum.</p>
          </div>
        )}
      </div>

      {/* 3. Fee & Discount Tracking (Synced with Billing Ledger) */}
      <div className="space-y-4 pt-4 border-t border-[var(--border)]">
        <div className="flex items-center gap-2 border-b border-[var(--border)] pb-2 text-xs font-semibold uppercase tracking-wider text-muted">
          <Receipt className="size-4 text-[var(--brand)]" />
          <span>Fee Billing & Scholarship Discount Structure</span>
        </div>

        <FormGrid>
          <Field
            label="Course / Admission Fee (₹)"
            htmlFor="feeAmount"
            hint="Leave 0 if fees will be billed separately later"
          >
            <input
              id="feeAmount"
              name="feeAmount"
              type="number"
              min="0"
              step="100"
              placeholder="e.g. 25000"
              value={feeAmount}
              onChange={(e) => setFeeAmount(e.target.value)}
              className="input font-mono"
            />
          </Field>

          <Field
            label="Concession / Discount (₹)"
            htmlFor="discountAmount"
            hint="Approved scholarship or promotional discount"
          >
            <input
              id="discountAmount"
              name="discountAmount"
              type="number"
              min="0"
              step="100"
              placeholder="e.g. 5000"
              value={discountAmount}
              onChange={(e) => setDiscountAmount(e.target.value)}
              className="input font-mono"
            />
          </Field>

          <Field
            label="Payment Due Date"
            htmlFor="feeDueDate"
            hint="Default is 14 days from today"
          >
            <input
              id="feeDueDate"
              name="feeDueDate"
              type="date"
              defaultValue={new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10)}
              className="input"
            />
          </Field>

          {/* Net Calculation Summary Card */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs text-muted">
              <span>Financial Synchronization:</span>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">Ledger Auto-Sync</span>
            </div>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-xs font-medium text-[var(--text)]">Net Billed to Student:</span>
              <span className="text-xl font-bold font-mono tracking-tight text-foreground">
                ₹{netPayable.toLocaleString("en-IN")}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-muted">
              {numFee > 0
                ? `Creates an official Fee Invoice with ₹${numDiscount.toLocaleString("en-IN")} discount recorded.`
                : "No invoice will be created until tuition fees are allocated."}
            </p>
          </div>
        </FormGrid>
      </div>
    </ActionForm>
  );
}
