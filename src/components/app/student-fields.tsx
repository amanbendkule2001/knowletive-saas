import { Field, FormGrid } from "@/components/ui/form-field";
import { FormIntro } from "@/components/ui/form-field";
import { isoDate } from "@/lib/format";
import type { FormState } from "@/lib/validation";

type ClassOption = {
  id: string;
  name: string;
  sections: { id: string; name: string }[];
};

type StudentDefaults = {
  id?: string;
  firstName?: string;
  lastName?: string;
  admissionNo?: string;
  email?: string | null;
  phone?: string | null;
  gender?: string | null;
  dob?: Date | null;
  bloodGroup?: string | null;
  address?: string | null;
  classId?: string | null;
  sectionId?: string | null;
  status?: string;
};

export function StudentFields({
  classes,
  student,
  mode,
  errors,
}: {
  classes: ClassOption[];
  student?: StudentDefaults | null;
  mode: "create" | "edit";
  errors?: FormState["fieldErrors"];
}) {
  return (
    <div className="space-y-5">
      <FormIntro
        title="Student details"
        description="Only the name and admission number are required. You can fill the rest later."
      />

      <FormGrid>
        <Field label="First name" htmlFor="firstName" required error={errors?.firstName}>
          <input
            id="firstName"
            name="firstName"
            className="input"
            defaultValue={student?.firstName ?? ""}
            autoComplete="given-name"
            required
          />
        </Field>
        <Field label="Last name" htmlFor="lastName" required error={errors?.lastName}>
          <input
            id="lastName"
            name="lastName"
            className="input"
            defaultValue={student?.lastName ?? ""}
            autoComplete="family-name"
            required
          />
        </Field>
        <Field
          label="Admission number"
          htmlFor="admissionNo"
          required
          error={errors?.admissionNo}
          hint="Must be unique inside this institute."
        >
          <input
            id="admissionNo"
            name="admissionNo"
            className="input font-mono"
            defaultValue={student?.admissionNo ?? ""}
            required
          />
        </Field>
        <Field label="Date of birth" htmlFor="dob" error={errors?.dob}>
          <input
            id="dob"
            name="dob"
            type="date"
            className="input"
            defaultValue={student?.dob ? isoDate(student.dob) : ""}
            max={isoDate(new Date())}
          />
        </Field>
        <Field label="Gender" htmlFor="gender" error={errors?.gender}>
          <select id="gender" name="gender" className="select" defaultValue={student?.gender ?? ""}>
            <option value="">Not specified</option>
            <option value="MALE">Male</option>
            <option value="FEMALE">Female</option>
            <option value="OTHER">Other</option>
          </select>
        </Field>
        <Field label="Blood group" htmlFor="bloodGroup" error={errors?.bloodGroup}>
          <input
            id="bloodGroup"
            name="bloodGroup"
            className="input"
            placeholder="e.g. O+"
            defaultValue={student?.bloodGroup ?? ""}
          />
        </Field>
        <Field label="Student email" htmlFor="email" error={errors?.email}>
          <input
            id="email"
            name="email"
            type="email"
            className="input"
            placeholder="optional"
            defaultValue={student?.email ?? ""}
            autoComplete="email"
          />
        </Field>
        <Field label="Student phone" htmlFor="phone" error={errors?.phone}>
          <input
            id="phone"
            name="phone"
            type="tel"
            className="input"
            placeholder="optional"
            defaultValue={student?.phone ?? ""}
            autoComplete="tel"
          />
        </Field>
      </FormGrid>

      <FormGrid>
        <Field
          label="Class"
          htmlFor="classId"
          error={errors?.classId}
          hint="Choose a class, or a section below."
        >
          <select id="classId" name="classId" className="select" defaultValue={student?.classId ?? ""}>
            <option value="">Not assigned</option>
            {classes.map((cls) => (
              <option key={cls.id} value={cls.id}>
                {cls.name}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Section"
          htmlFor="sectionId"
          error={errors?.sectionId}
          hint="Section takes precedence over the class choice."
        >
          <select id="sectionId" name="sectionId" className="select" defaultValue={student?.sectionId ?? ""}>
            <option value="">No section</option>
            {classes.map((cls) => (
              <optgroup key={cls.id} label={cls.name}>
                {cls.sections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {cls.name} — {section.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>
        {mode === "edit" && (
          <Field label="Status" htmlFor="status" error={errors?.status}>
            <select id="status" name="status" className="select" defaultValue={student?.status ?? "ACTIVE"}>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
              <option value="ALUMNI">Alumni</option>
            </select>
          </Field>
        )}
        <Field label="Address" htmlFor="address" error={errors?.address} className={mode === "edit" ? "" : "sm:col-span-2"}>
          <textarea
            id="address"
            name="address"
            className="textarea"
            rows={2}
            placeholder="House, street, city"
            defaultValue={student?.address ?? ""}
          />
        </Field>
      </FormGrid>

      {mode === "create" && (
        <>
          <FormIntro
            title="Primary guardian"
            description="Optional, but strongly recommended for fee reminders and attendance alerts. You can add more guardians from the Parents page."
          />
          <FormGrid>
            <Field label="Guardian name" htmlFor="guardianName" error={errors?.guardianName}>
              <input id="guardianName" name="guardianName" className="input" placeholder="Full name" />
            </Field>
            <Field
              label="Guardian phone"
              htmlFor="guardianPhone"
              error={errors?.guardianPhone}
              hint="Add both name and phone, or leave both blank."
            >
              <input id="guardianPhone" name="guardianPhone" type="tel" className="input" placeholder="+91…" />
            </Field>
            <Field label="Guardian email" htmlFor="guardianEmail" error={errors?.guardianEmail}>
              <input id="guardianEmail" name="guardianEmail" type="email" className="input" placeholder="optional" />
            </Field>
            <Field label="Relationship" htmlFor="guardianRelation" error={errors?.guardianRelation}>
              <select id="guardianRelation" name="guardianRelation" className="select" defaultValue="Father">
                <option value="Father">Father</option>
                <option value="Mother">Mother</option>
                <option value="Guardian">Guardian</option>
                <option value="Grandparent">Grandparent</option>
                <option value="Other">Other</option>
              </select>
            </Field>
          </FormGrid>
        </>
      )}
    </div>
  );
}
