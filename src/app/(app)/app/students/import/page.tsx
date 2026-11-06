import Link from "next/link";
import { ArrowLeft, Download, FileSpreadsheet, Upload } from "lucide-react";
import { requireTenantWrite } from "@/lib/rbac";
import { importStudentsAction } from "@/actions/students";
import { ActionForm } from "@/components/ui/action-form";
import { Callout, Card, CardHeader, PageHeader } from "@/components/ui/primitives";

export const metadata = { title: "Import students" };

const COLUMNS = [
  { name: "admissionNo", required: true, note: "Unique within the institute" },
  { name: "firstName", required: true, note: "Student first name" },
  { name: "lastName", required: true, note: "Student last name" },
  { name: "class", required: false, note: "Must match a class name exactly, e.g. Class 6" },
  { name: "section", required: false, note: "Section letter, e.g. A" },
  { name: "gender", required: false, note: "MALE, FEMALE or OTHER" },
  { name: "dob", required: false, note: "YYYY-MM-DD" },
  { name: "email", required: false, note: "Student email" },
  { name: "phone", required: false, note: "Student phone" },
  { name: "guardianName", required: false, note: "Primary guardian" },
  { name: "guardianPhone", required: false, note: "Required when guardianName is set" },
  { name: "guardianEmail", required: false, note: "Optional" },
  { name: "guardianRelation", required: false, note: "Father, Mother, Guardian…" },
];

export default async function ImportStudentsPage() {
  await requireTenantWrite("tenant.students.write");

  return (
    <div className="space-y-5">
      <Link
        href="/app/students"
        className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-[var(--text)]"
      >
        <ArrowLeft className="size-3.5" /> All students
      </Link>

      <PageHeader
        eyebrow="Admissions"
        title="Import students from CSV"
        description="Bring an existing student list in one pass. Rows with duplicate admission numbers are skipped, never overwritten."
        actions={
          <Link href="/app/students/export" className="btn btn-secondary">
            <Download className="size-3.5" /> Download current list
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHeader title="Upload a CSV" description="UTF-8, up to 2 MB and 300 rows per import." />
          <div className="p-4">
            <ActionForm
              action={importStudentsAction}
              submitLabel="Import students"
              pendingLabel="Importing…"
              cancelHref="/app/students"
            >
              <label
                htmlFor="file"
                className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-[var(--border-strong)] px-4 py-10 text-center transition hover:border-[var(--brand)] hover:bg-[var(--surface-2)]"
              >
                <span className="grid size-11 place-items-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
                  <FileSpreadsheet className="size-5" />
                </span>
                <span className="mt-3 text-sm font-semibold">Choose a .csv file</span>
                <span className="mt-1 text-xs text-muted">
                  Export from Excel or Google Sheets with a header row
                </span>
                <input id="file" name="file" type="file" accept=".csv,text/csv" className="sr-only" required />
                <span className="btn btn-secondary btn-sm mt-4">
                  <Upload className="size-3.5" /> Browse files
                </span>
              </label>
            </ActionForm>
          </div>
        </Card>

        <div className="space-y-4">
          <Callout tone="info" title="Import rules">
            Only <strong>admissionNo</strong>, <strong>firstName</strong> and <strong>lastName</strong>{" "}
            are mandatory. Classes and sections are matched by name — create them in{" "}
            <Link href="/app/academics" className="underline">
              Academics
            </Link>{" "}
            first. Guardian rows need both a name and a phone number. Your plan&apos;s student limit is
            checked before anything is written.
          </Callout>

          <Card>
            <CardHeader title="Expected columns" description="Header names are case-insensitive." />
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Column</th>
                    <th>Required</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {COLUMNS.map((column) => (
                    <tr key={column.name}>
                      <td className="font-mono text-[11px]">{column.name}</td>
                      <td>
                        {column.required ? (
                          <span className="badge badge-warning">Yes</span>
                        ) : (
                          <span className="badge badge-neutral">No</span>
                        )}
                      </td>
                      <td className="text-muted">{column.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
