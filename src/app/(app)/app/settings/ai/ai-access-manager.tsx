"use client";

import { useState, useTransition } from "react";
import {
  Search,
  Shield,
  Bot,
  CheckCircle2,
  XCircle,
  Sparkles,
  Settings2,
  AlertTriangle,
  RotateCcw,
  Check,
} from "lucide-react";
import {
  TenantAiMemberSummary,
  updateAiPermissionsAction,
  revokeAllAiPermissionsAction,
} from "@/actions/ai-access";
import { Badge, Avatar } from "@/components/ui/primitives";

export const AI_MODULE_DEFS = [
  {
    key: "tenant.ai.copilot",
    label: "Conversational AI Copilot",
    description: "Interactive chat assistant with live student, attendance, and fee data synthesis.",
    category: "copilot",
  },
  {
    key: "tenant.ai.analytics.institute",
    label: "Institute Executive Analytics",
    description: "High-level institutional KPI, trend forecasting, and executive overviews.",
    category: "analytics",
  },
  {
    key: "tenant.ai.analytics.student",
    label: "Student Performance Insights",
    description: "Academic progress tracking, student intervention flags, and grade predictions.",
    category: "analytics",
  },
  {
    key: "tenant.ai.analytics.attendance",
    label: "Attendance Analytics",
    description: "Absenteeism pattern detection, anomaly tracking, and attendance summaries.",
    category: "analytics",
  },
  {
    key: "tenant.ai.analytics.fees",
    label: "Fee & Financial Insights",
    description: "Delinquency predictions, collection velocity, and fee recovery summaries.",
    category: "analytics",
  },
  {
    key: "tenant.ai.analytics.admissions",
    label: "Admissions & Leads Prediction",
    description: "Inquiry conversion likelihood and demographic trend analysis.",
    category: "analytics",
  },
  {
    key: "tenant.ai.analytics.exams",
    label: "Exam & Grade Analytics",
    description: "Subject difficulty analysis, score distributions, and class comparative metrics.",
    category: "analytics",
  },
  {
    key: "tenant.ai.reports.generate",
    label: "Automated Report Generation",
    description: "AI-assisted PDF and narrative report compilation for students and staff.",
    category: "automation",
  },
  {
    key: "tenant.ai.document.intelligence",
    label: "Document & Receipt Intelligence",
    description: "OCR extraction and parsing for receipts, marksheets, and identity documents.",
    category: "automation",
  },
  {
    key: "tenant.ai.workflows",
    label: "Automated AI Workflows",
    description: "Multi-step agent workflows for notifications, reminders, and alerts.",
    category: "automation",
  },
];

interface Props {
  initialMembers: TenantAiMemberSummary[];
  isOwnerOrPlatform: boolean;
}

export function AiAccessManager({ initialMembers, isOwnerOrPlatform }: Props) {
  const [members, setMembers] = useState<TenantAiMemberSummary[]>(initialMembers);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [selectedMember, setSelectedMember] = useState<TenantAiMemberSummary | null>(null);
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();
  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const roles = Array.from(new Set(initialMembers.map((m) => m.roleKey)));

  const filtered = members.filter((m) => {
    const matchesSearch =
      !search ||
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.email.toLowerCase().includes(search.toLowerCase());
    const matchesRole = roleFilter === "ALL" || m.roleKey === roleFilter;
    return matchesSearch && matchesRole;
  });

  const openConfigModal = (member: TenantAiMemberSummary) => {
    setSelectedMember(member);
    // If owner, they have full permissions inherently; otherwise copy current grants
    if (member.isOwner || member.isPlatformOwner) {
      setSelectedPermissions(AI_MODULE_DEFS.map((d) => d.key));
    } else {
      setSelectedPermissions([...member.aiPermissions]);
    }
    setNotification(null);
  };

  const togglePermission = (key: string) => {
    setSelectedPermissions((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  const handleSave = () => {
    if (!selectedMember) return;

    startTransition(async () => {
      const res = await updateAiPermissionsAction(selectedMember.membershipId, selectedPermissions);
      if (res.ok) {
        setMembers((prev) =>
          prev.map((m) =>
            m.membershipId === selectedMember.membershipId
              ? {
                  ...m,
                  aiPermissions: res.updatedPermissions || [],
                  hasCopilotAccess:
                    m.isOwner ||
                    m.isPlatformOwner ||
                    Boolean(res.updatedPermissions?.includes("tenant.ai.copilot")),
                }
              : m,
          ),
        );
        setNotification({
          type: "success",
          message: `Permissions updated for ${selectedMember.name}.`,
        });
        setSelectedMember(null);
      } else {
        setNotification({
          type: "error",
          message: res.error || "Failed to update AI permissions.",
        });
      }
    });
  };

  const handleRevokeAll = () => {
    if (!selectedMember) return;
    if (
      !confirm(
        `Are you sure you want to revoke all AI permissions for ${selectedMember.name}? They will lose access to the Copilot and all AI modules immediately.`,
      )
    ) {
      return;
    }

    startTransition(async () => {
      const res = await revokeAllAiPermissionsAction(selectedMember.membershipId);
      if (res.ok) {
        setMembers((prev) =>
          prev.map((m) =>
            m.membershipId === selectedMember.membershipId
              ? {
                  ...m,
                  aiPermissions: [],
                  hasCopilotAccess: m.isOwner || m.isPlatformOwner,
                }
              : m,
          ),
        );
        setNotification({
          type: "success",
          message: `All AI permissions revoked for ${selectedMember.name}.`,
        });
        setSelectedMember(null);
      } else {
        setNotification({
          type: "error",
          message: res.error || "Failed to revoke permissions.",
        });
      }
    });
  };

  return (
    <div className="space-y-4">
      {notification && (
        <div
          className={`flex items-center justify-between p-3 rounded-lg text-sm ${
            notification.type === "success"
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
              : "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20"
          }`}
        >
          <span>{notification.message}</span>
          <button
            onClick={() => setNotification(null)}
            className="text-xs opacity-70 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[var(--muted)]" />
          <input
            type="text"
            placeholder="Search member by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input pl-9 w-full"
          />
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="select w-full sm:w-44 text-sm"
          >
            <option value="ALL">All Roles ({initialMembers.length})</option>
            {roles.map((r) => (
              <option key={r} value={r}>
                {r.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Members Table */}
      <div className="table-wrap border border-[var(--border)] rounded-xl bg-[var(--surface)] overflow-hidden">
        <table className="data-table w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--muted-surface)] text-[var(--muted)] text-xs uppercase tracking-wider">
              <th className="py-3 px-4 font-semibold">User</th>
              <th className="py-3 px-4 font-semibold">Role</th>
              <th className="py-3 px-4 font-semibold">Copilot Access</th>
              <th className="py-3 px-4 font-semibold">AI Capabilities</th>
              <th className="py-3 px-4 text-right font-semibold">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-[var(--muted)]">
                  No members matched your search criteria.
                </td>
              </tr>
            ) : (
              filtered.map((m) => {
                const isOwner = m.isOwner || m.isPlatformOwner;
                return (
                  <tr key={m.membershipId} className="hover:bg-[var(--hover-surface)] transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <Avatar name={m.name} />
                        <div>
                          <div className="font-medium text-[var(--foreground)] flex items-center gap-1.5">
                            {m.name}
                            {m.isOwner && (
                              <Badge tone="brand" className="text-[10px] py-0 px-1.5">
                                Institute Owner
                              </Badge>
                            )}
                            {m.isPlatformOwner && (
                              <Badge tone="info" className="text-[10px] py-0 px-1.5">
                                Platform Owner
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-[var(--muted)]">{m.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <Badge tone="neutral" className="text-xs">
                        {m.roleName}
                      </Badge>
                    </td>
                    <td className="py-3 px-4">
                      {m.hasCopilotAccess ? (
                        <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                          <CheckCircle2 className="size-4" />
                          <span>Enabled</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
                          <XCircle className="size-4" />
                          <span>Disabled</span>
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {isOwner ? (
                        <span className="text-xs font-medium text-[var(--brand)]">
                          Full Access (10 / 10)
                        </span>
                      ) : m.aiPermissions.length > 0 ? (
                        <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                          {m.aiPermissions.length} / 10 Modules
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--muted)]">None granted</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => openConfigModal(m)}
                        disabled={!isOwnerOrPlatform}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] hover:bg-[var(--hover-surface)] text-[var(--foreground)] transition-colors disabled:opacity-50"
                      >
                        <Settings2 className="size-3.5" />
                        Configure
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Configuration Modal */}
      {selectedMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-2xl bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="p-5 border-b border-[var(--border)] flex items-center justify-between bg-[var(--muted-surface)]">
              <div>
                <h3 className="text-lg font-semibold text-[var(--foreground)] flex items-center gap-2">
                  <Bot className="size-5 text-[var(--brand)]" />
                  Configure AI Capabilities
                </h3>
                <p className="text-xs text-[var(--muted)] mt-0.5">
                  Managing access for <strong className="text-[var(--foreground)]">{selectedMember.name}</strong> ({selectedMember.email})
                </p>
              </div>
              <button
                onClick={() => setSelectedMember(null)}
                className="text-[var(--muted)] hover:text-[var(--foreground)] text-lg px-2 py-1 rounded"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto space-y-5 flex-1">
              {selectedMember.isOwner && (
                <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 text-xs flex items-start gap-2">
                  <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                  <span>
                    This user is a verified <strong>Institute Owner</strong> and possesses default access to all AI modules. Permission adjustments will apply to explicit grants on their membership record.
                  </span>
                </div>
              )}

              {/* Quick Actions */}
              <div className="flex flex-wrap items-center gap-2 pb-2 border-b border-[var(--border)]">
                <span className="text-xs text-[var(--muted)] font-medium mr-1">Presets:</span>
                <button
                  type="button"
                  onClick={() => setSelectedPermissions(["tenant.ai.copilot"])}
                  className="px-2.5 py-1 text-xs rounded-md bg-[var(--surface)] border border-[var(--border)] hover:bg-[var(--hover-surface)] text-[var(--foreground)]"
                >
                  Copilot Only
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setSelectedPermissions(
                      AI_MODULE_DEFS.filter((d) => d.category === "analytics" || d.key === "tenant.ai.copilot").map(
                        (d) => d.key,
                      ),
                    )
                  }
                  className="px-2.5 py-1 text-xs rounded-md bg-[var(--surface)] border border-[var(--border)] hover:bg-[var(--hover-surface)] text-[var(--foreground)]"
                >
                  Copilot + Analytics
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedPermissions(AI_MODULE_DEFS.map((d) => d.key))}
                  className="px-2.5 py-1 text-xs rounded-md bg-[var(--surface)] border border-[var(--border)] hover:bg-[var(--hover-surface)] text-[var(--foreground)]"
                >
                  Select All (10)
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedPermissions([])}
                  className="px-2.5 py-1 text-xs rounded-md bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 hover:bg-rose-500/20"
                >
                  Clear All
                </button>
              </div>

              {/* Permission Checkboxes List */}
              <div className="space-y-3">
                {AI_MODULE_DEFS.map((mod) => {
                  const isChecked = selectedPermissions.includes(mod.key);
                  return (
                    <label
                      key={mod.key}
                      className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                        isChecked
                          ? "bg-[var(--brand-surface,rgba(79,70,229,0.05))] border-[var(--brand)]"
                          : "bg-[var(--surface)] border-[var(--border)] hover:border-[var(--muted)]"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => togglePermission(mod.key)}
                        className="mt-1 size-4 rounded border-[var(--border)] text-[var(--brand)] focus:ring-[var(--brand)]"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-[var(--foreground)]">
                            {mod.label}
                          </span>
                          <span className="font-mono text-[10px] text-[var(--muted)] bg-[var(--muted-surface)] px-1.5 py-0.5 rounded">
                            {mod.key}
                          </span>
                        </div>
                        <p className="text-xs text-[var(--muted)] mt-0.5">{mod.description}</p>
                      </div>
                    </label>
                  );
                })}
              </div>

              {/* Domain Read Isolation Disclaimer */}
              <div className="p-3 bg-[var(--muted-surface)] rounded-xl text-xs text-[var(--muted)] flex items-start gap-2 border border-[var(--border)]">
                <Shield className="size-4 shrink-0 text-[var(--brand)] mt-0.5" />
                <span>
                  <strong>Strict Security Isolation:</strong> Granting AI capabilities enables the user to query synthesized insights, but underlying database read permissions (e.g. fees, exams, staff) are still strictly verified. Users will never view data they lack permission to access.
                </span>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-[var(--border)] bg-[var(--muted-surface)] flex items-center justify-between">
              <button
                type="button"
                onClick={handleRevokeAll}
                disabled={isPending || selectedMember.isOwner}
                className="px-3 py-1.5 text-xs font-medium text-rose-600 hover:text-rose-700 dark:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors disabled:opacity-40"
              >
                Revoke All Access
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedMember(null)}
                  disabled={isPending}
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--hover-surface)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isPending}
                  className="px-4 py-2 text-xs font-medium rounded-lg bg-[var(--brand)] text-white hover:opacity-90 transition-opacity flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isPending ? "Saving…" : "Save Permissions"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
