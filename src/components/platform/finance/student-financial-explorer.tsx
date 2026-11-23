"use client";

import { useEffect, useState, useTransition } from "react";
import {
  Search,
  User,
  Filter,
  ArrowRight,
  School,
  Building,
  Coins,
  CheckCircle2,
  Clock,
  AlertCircle,
  FileText,
  CreditCard,
} from "lucide-react";
import { Badge, Card } from "@/components/ui/primitives";
import { money } from "@/lib/format";
import {
  getStudentFinancialListAction,
  type StudentFinancialListRow,
} from "@/actions/finance-reconciliation";
import { StudentFinancialDrawer } from "./student-financial-drawer";

interface StudentFinancialExplorerProps {
  initialStudents: StudentFinancialListRow[];
  tenants: Array<{ id: string; name: string }>;
}

export function StudentFinancialExplorer({
  initialStudents,
  tenants,
}: StudentFinancialExplorerProps) {
  const [students, setStudents] = useState<StudentFinancialListRow[]>(initialStudents);
  const [search, setSearch] = useState("");
  const [selectedTenantId, setSelectedTenantId] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Fetch filtered students when filters change
  const handleApplyFilter = (newSearch: string, newTenant: string, newStatus: string) => {
    startTransition(async () => {
      try {
        const rows = await getStudentFinancialListAction({
          tenantId: newTenant !== "ALL" ? newTenant : undefined,
          search: newSearch || undefined,
          status: newStatus !== "ALL" ? newStatus : undefined,
          limit: 100,
        });
        setStudents(rows);
      } catch (err) {
        console.error("Failed to load students:", err);
      }
    });
  };

  const handleSearchChange = (val: string) => {
    setSearch(val);
    handleApplyFilter(val, selectedTenantId, statusFilter);
  };

  const handleTenantChange = (val: string) => {
    setSelectedTenantId(val);
    handleApplyFilter(search, val, statusFilter);
  };

  const handleStatusChange = (val: string) => {
    setStatusFilter(val);
    handleApplyFilter(search, selectedTenantId, val);
  };

  return (
    <div className="space-y-4">
      {/* Search and Filters Bar */}
      <Card className="p-4 shadow-sm border-[var(--border)]">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search by student name, admission number (e.g. SPS-2026-1001) or email…"
              className="w-full pl-9.5 pr-4 py-2 text-xs rounded-xl border border-[var(--border)] bg-[var(--surface-2)]/50 focus:bg-[var(--surface)] focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition outline-none"
            />
            {search && (
              <button
                type="button"
                onClick={() => handleSearchChange("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted hover:text-foreground"
              >
                Clear
              </button>
            )}
          </div>

          {/* Institution Filter Dropdown */}
          <div className="w-full md:w-56">
            <select
              value={selectedTenantId}
              onChange={(e) => handleTenantChange(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-[var(--border)] bg-[var(--surface)] focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none"
            >
              <option value="ALL">All Institutions ({tenants.length})</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-1 overflow-x-auto text-xs no-scrollbar">
            {["ALL", "PAID", "PARTIAL", "DUE", "OVERDUE", "UNBILLED"].map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => handleStatusChange(st)}
                className={`px-2.5 py-1.5 rounded-lg whitespace-nowrap transition text-[11px] font-medium ${
                  statusFilter === st
                    ? "bg-indigo-600 text-white font-semibold shadow-xs"
                    : "bg-[var(--surface-2)] text-muted hover:text-foreground"
                }`}
              >
                {st === "ALL" ? "All" : st}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* Student Financial Records Table */}
      <Card className="p-0 shadow-sm border-[var(--border)] overflow-hidden">
        <div className="p-4 border-b border-[var(--border)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-sm text-foreground">Student Accounts Directory</h3>
            <Badge tone="brand">{students.length} Students</Badge>
          </div>
          {isPending && (
            <span className="text-[11px] text-muted flex items-center gap-1">
              <span className="size-2 bg-indigo-600 rounded-full animate-ping" /> Filtering…
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-[var(--border)] text-muted font-semibold uppercase text-[10px] tracking-wider bg-[var(--surface-2)]/40">
                <th className="py-2.5 px-4">Student & Admission</th>
                <th className="py-2.5 px-4">Institution & Campus</th>
                <th className="py-2.5 px-4">Class</th>
                <th className="py-2.5 px-4 text-right">Agreed Plan</th>
                <th className="py-2.5 px-4 text-right">Billed Invoices</th>
                <th className="py-2.5 px-4 text-right">Collected</th>
                <th className="py-2.5 px-4 text-right">Outstanding</th>
                <th className="py-2.5 px-4 text-center">Status</th>
                <th className="py-2.5 pr-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {students.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-xs text-muted">
                    No student records matching your search and filter criteria.
                  </td>
                </tr>
              ) : (
                students.map((student) => (
                  <tr
                    key={student.id}
                    className="hover:bg-[var(--surface-2)]/40 transition cursor-pointer"
                    onClick={() => setSelectedStudentId(student.id)}
                  >
                    <td className="py-3 px-4">
                      <div className="font-bold text-foreground">{student.name}</div>
                      <div className="font-mono text-[11px] text-muted">{student.admissionNo}</div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-foreground">{student.tenantName}</div>
                      <div className="text-[11px] text-muted">
                        {student.branchName} ({student.branchType})
                      </div>
                    </td>
                    <td className="py-3 px-4 text-muted">
                      {student.classGrade} ({student.section})
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-medium">
                      {student.assignedFeePaise > 0 ? money(student.assignedFeePaise) : "—"}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-medium">
                      {money(student.invoicedFeePaise)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-emerald-600">
                      {money(student.paidFeePaise)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold">
                      <span className={student.outstandingPaise > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted"}>
                        {money(student.outstandingPaise)}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <Badge
                        tone={
                          student.status === "PAID"
                            ? "success"
                            : student.status === "OVERDUE"
                            ? "danger"
                            : student.status === "PARTIAL"
                            ? "brand"
                            : "neutral"
                        }
                        className="text-[9px]"
                      >
                        {student.status}
                      </Badge>
                    </td>
                    <td className="py-3 pr-4 text-right" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => setSelectedStudentId(student.id)}
                        className="btn btn-secondary text-[11px] py-1 px-2.5 inline-flex items-center gap-1 shadow-xs"
                      >
                        Audit <ArrowRight className="size-3" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* 8-Tab Slide-Over Drawer */}
      <StudentFinancialDrawer
        studentId={selectedStudentId}
        onClose={() => setSelectedStudentId(null)}
      />
    </div>
  );
}
