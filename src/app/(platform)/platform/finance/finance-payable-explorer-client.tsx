"use client";

import { useMemo, useState } from "react";
import {
  Building2,
  School,
  Landmark,
  CheckCircle2,
  Search,
  Wallet,
  ArrowRight,
  RefreshCw,
  Coins,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  Building,
  CreditCard,
  AlertCircle,
} from "lucide-react";
import { Badge, Card, CardHeader } from "@/components/ui/primitives";
import { ActionForm } from "@/components/ui/action-form";
import { recordManualPlatformPayoutAction } from "@/actions/platform-payouts";
import { money, num } from "@/lib/format";

export interface BranchPayableInfo {
  tenantId: string;
  tenantName: string;
  branchId: string;
  branchName: string;
  branchCode: string;
  branchType: string; // "MAIN" | "SUB_BRANCH"
  parentBranchName?: string | null;
  collectorCode: string | null;
  bankAccount: string | null;
  bankIfsc: string | null;
  bankBankName: string | null;
  studentCount: number;
  invoicedCount: number;
  settledPayableBalance: number; // in paise
}

export interface InstitutePayableGroup {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  tenantType: string;
  totalSettledBalance: number; // in paise
  mainBranch: BranchPayableInfo | null;
  subBranches: BranchPayableInfo[];
  allBranches: BranchPayableInfo[];
}

interface FinancePayableExplorerClientProps {
  instituteGroups: InstitutePayableGroup[];
  allBranches: BranchPayableInfo[];
}

export function FinancePayableExplorerClient({
  instituteGroups,
  allBranches,
}: FinancePayableExplorerClientProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState<"ALL" | "WITH_BALANCE" | "MULTI_CAMPUS">("ALL");
  const [expandedInstitutes, setExpandedInstitutes] = useState<Record<string, boolean>>(() => {
    // Expand institutes with balance by default
    const initial: Record<string, boolean> = {};
    for (const g of instituteGroups) {
      if (g.totalSettledBalance > 0 || g.subBranches.length > 0) {
        initial[g.tenantId] = true;
      }
    }
    return initial;
  });

  // Find branches that have payable balance for the payout form
  const payableBranches = useMemo(
    () => allBranches.filter((b) => b.settledPayableBalance > 0),
    [allBranches]
  );

  // Default to first branch with balance, or first branch overall
  const [selectedBranchId, setSelectedBranchId] = useState<string>(() => {
    return payableBranches[0]?.branchId || allBranches[0]?.branchId || "";
  });

  const selectedBranch = useMemo(
    () => allBranches.find((b) => b.branchId === selectedBranchId) || null,
    [allBranches, selectedBranchId]
  );

  // Amount in Rupees (controlled input so selecting a campus auto-fills the amount)
  const [payoutAmount, setPayoutAmount] = useState<string>(() => {
    const initBranch = payableBranches[0] || allBranches[0];
    return initBranch ? Math.floor(initBranch.settledPayableBalance / 100).toString() : "";
  });

  const [payoutUtr, setPayoutUtr] = useState<string>(
    () => `SBIN${Math.floor(10000000 + Math.random() * 90000000)}`
  );

  // Handle branch selection in dropdown -> auto-populate amount in rupees
  const handleBranchChange = (branchId: string) => {
    setSelectedBranchId(branchId);
    const target = allBranches.find((b) => b.branchId === branchId);
    if (target) {
      setPayoutAmount(Math.floor(target.settledPayableBalance / 100).toString());
    }
  };

  // When clicking "Disburse" on any branch card
  const handleSelectBranchForPayout = (branchId: string) => {
    handleBranchChange(branchId);
    // Smooth scroll to payout form
    const formEl = document.getElementById("payout-form-section");
    if (formEl) {
      formEl.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const toggleExpand = (tenantId: string) => {
    setExpandedInstitutes((prev) => ({ ...prev, [tenantId]: !prev[tenantId] }));
  };

  // Filtered institutes
  const filteredInstitutes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return instituteGroups.filter((group) => {
      // 1. Filter mode
      if (filterMode === "WITH_BALANCE" && group.totalSettledBalance <= 0) {
        return false;
      }
      if (filterMode === "MULTI_CAMPUS" && group.allBranches.length <= 1) {
        return false;
      }

      // 2. Search query match
      if (!q) return true;

      const tenantMatch =
        group.tenantName.toLowerCase().includes(q) ||
        group.tenantSlug.toLowerCase().includes(q) ||
        group.tenantType.toLowerCase().includes(q);

      const branchMatch = group.allBranches.some(
        (b) =>
          b.branchName.toLowerCase().includes(q) ||
          b.branchCode.toLowerCase().includes(q) ||
          (b.collectorCode && b.collectorCode.toLowerCase().includes(q)) ||
          (b.bankAccount && b.bankAccount.toLowerCase().includes(q)) ||
          (b.bankIfsc && b.bankIfsc.toLowerCase().includes(q)) ||
          (b.bankBankName && b.bankBankName.toLowerCase().includes(q))
      );

      return tenantMatch || branchMatch;
    });
  }, [instituteGroups, searchQuery, filterMode]);

  const totalBranchesCount = filteredInstitutes.reduce(
    (sum, g) => sum + g.allBranches.length,
    0
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left Column (2 Cols): Hierarchical Institute & Branch Explorer */}
      <div className="lg:col-span-2 space-y-4">
        <Card className="p-5 sm:p-6 shadow-sm border-[var(--border)]">
          {/* Header & Description */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[var(--border)]">
            <div>
              <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                <Building className="size-4.5 text-indigo-600" />
                Institution & Campus Payable Balances
              </h3>
              <p className="text-xs text-muted mt-0.5">
                Organized hierarchy by Institute with Main Campus & Sub-Branch breakdown.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone="brand">{filteredInstitutes.length} Institutes</Badge>
              <Badge tone="neutral">{totalBranchesCount} Campuses</Badge>
            </div>
          </div>

          {/* Search Bar & Quick Filters */}
          <div className="mt-4 space-y-3">
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by institute name, campus, collector code, or bank account…"
                className="w-full pl-9.5 pr-4 py-2 text-xs rounded-xl border border-[var(--border)] bg-[var(--surface-2)]/50 focus:bg-[var(--surface)] focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted hover:text-foreground"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Quick Filter Tabs */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <button
                type="button"
                onClick={() => setFilterMode("ALL")}
                className={`px-3 py-1 rounded-lg font-medium transition ${
                  filterMode === "ALL"
                    ? "bg-indigo-600 text-white shadow-xs"
                    : "bg-[var(--surface-2)] text-muted hover:text-foreground"
                }`}
              >
                All Institutes ({instituteGroups.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterMode("WITH_BALANCE")}
                className={`px-3 py-1 rounded-lg font-medium transition flex items-center gap-1.5 ${
                  filterMode === "WITH_BALANCE"
                    ? "bg-emerald-600 text-white shadow-xs"
                    : "bg-[var(--surface-2)] text-muted hover:text-foreground"
                }`}
              >
                <Coins className="size-3" />
                With Payable Balance ({instituteGroups.filter((g) => g.totalSettledBalance > 0).length})
              </button>
              <button
                type="button"
                onClick={() => setFilterMode("MULTI_CAMPUS")}
                className={`px-3 py-1 rounded-lg font-medium transition flex items-center gap-1.5 ${
                  filterMode === "MULTI_CAMPUS"
                    ? "bg-blue-600 text-white shadow-xs"
                    : "bg-[var(--surface-2)] text-muted hover:text-foreground"
                }`}
              >
                <Building2 className="size-3" />
                Multi-Campus Chains ({instituteGroups.filter((g) => g.allBranches.length > 1).length})
              </button>
            </div>
          </div>

          {/* Grouped Institute List */}
          <div className="mt-4 space-y-3.5">
            {filteredInstitutes.length === 0 ? (
              <div className="py-12 text-center text-xs text-muted">
                No institutes found matching &ldquo;{searchQuery}&rdquo;. Try another search keyword.
              </div>
            ) : (
              filteredInstitutes.map((group) => {
                const isExpanded = !!expandedInstitutes[group.tenantId];
                const hasBalance = group.totalSettledBalance > 0;

                return (
                  <div
                    key={group.tenantId}
                    className={`rounded-2xl border transition duration-150 overflow-hidden ${
                      hasBalance
                        ? "border-indigo-200 dark:border-indigo-900/60 bg-[var(--surface)] shadow-xs"
                        : "border-[var(--border)] bg-[var(--surface-2)]/30"
                    }`}
                  >
                    {/* Institute Header Bar */}
                    <div
                      onClick={() => toggleExpand(group.tenantId)}
                      className={`p-3.5 sm:p-4 cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition ${
                        hasBalance
                          ? "bg-indigo-50/40 dark:bg-indigo-950/20 hover:bg-indigo-50/70"
                          : "hover:bg-[var(--surface-2)]/60"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`size-9 rounded-xl flex items-center justify-center shrink-0 ${
                            hasBalance
                              ? "bg-indigo-600 text-white shadow-xs"
                              : "bg-[var(--surface-3)] text-muted"
                          }`}
                        >
                          <School className="size-4.5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-foreground">
                              {group.tenantName}
                            </span>
                            <Badge tone="neutral" className="text-[10px]">
                              {group.tenantType}
                            </Badge>
                          </div>
                          <p className="text-[11px] text-muted mt-0.5 flex items-center gap-2">
                            <span>
                              {group.allBranches.length}{" "}
                              {group.allBranches.length === 1 ? "Campus" : "Campuses"} (
                              {group.mainBranch ? "1 Main" : "0 Main"},{" "}
                              {group.subBranches.length} Sub-Branch
                              {group.subBranches.length === 1 ? "" : "es"})
                            </span>
                          </p>
                        </div>
                      </div>

                      {/* Institute Total Balance & Toggle */}
                      <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                        <div className="text-left sm:text-right">
                          <span className="text-[10px] uppercase font-bold text-muted block">
                            Total Institute Balance
                          </span>
                          <span
                            className={`text-base font-extrabold ${
                              hasBalance
                                ? "text-emerald-700 dark:text-emerald-400"
                                : "text-muted"
                            }`}
                          >
                            {money(group.totalSettledBalance)}
                          </span>
                        </div>
                        <div className="size-7 rounded-lg bg-[var(--surface-2)] flex items-center justify-center text-muted hover:text-foreground">
                          {isExpanded ? (
                            <ChevronUp className="size-4" />
                          ) : (
                            <ChevronDown className="size-4" />
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Collapsible Branches Breakdown */}
                    {isExpanded && (
                      <div className="p-3.5 sm:p-4 border-t border-[var(--border)] space-y-2.5 bg-[var(--surface)]">
                        {/* 1. Main Branch Row */}
                        {group.mainBranch ? (
                          <div
                            className={`p-3 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs transition ${
                              group.mainBranch.settledPayableBalance > 0
                                ? "border-indigo-300 dark:border-indigo-800 bg-indigo-50/30 dark:bg-indigo-950/15"
                                : "border-[var(--border)] bg-[var(--surface-2)]/40"
                            }`}
                          >
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-foreground text-[13px] flex items-center gap-1.5">
                                  <ShieldCheck className="size-3.5 text-indigo-600" />
                                  {group.mainBranch.branchName}
                                </span>
                                <Badge tone="brand" className="text-[9px] font-bold">
                                  MAIN CAMPUS
                                </Badge>
                                {group.mainBranch.branchCode && (
                                  <span className="font-mono text-[10px] text-muted">
                                    [{group.mainBranch.branchCode}]
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-muted">
                                Jodo Collector:{" "}
                                <span className="font-mono font-medium text-foreground">
                                  {group.mainBranch.collectorCode || "Not Configured"}
                                </span>{" "}
                                &bull; Students:{" "}
                                <span className="font-medium text-foreground">
                                  {group.mainBranch.studentCount}
                                </span>
                              </p>
                              {group.mainBranch.bankAccount && (
                                <p className="text-[11px] text-muted">
                                  Bank:{" "}
                                  <span className="font-medium">
                                    {group.mainBranch.bankBankName || "Bank"}
                                  </span>{" "}
                                  &bull; A/C:{" "}
                                  <span className="font-mono">{group.mainBranch.bankAccount}</span>{" "}
                                  &bull; IFSC:{" "}
                                  <span className="font-mono">{group.mainBranch.bankIfsc}</span>
                                </p>
                              )}
                            </div>

                            <div className="flex md:flex-col items-center md:items-end justify-between gap-2 shrink-0">
                              <div className="text-left md:text-right">
                                <span className="text-[10px] uppercase font-bold text-muted block">
                                  Settled Balance
                                </span>
                                <span
                                  className={`text-sm font-bold ${
                                    group.mainBranch.settledPayableBalance > 0
                                      ? "text-indigo-700 dark:text-indigo-400 font-extrabold"
                                      : "text-muted"
                                  }`}
                                >
                                  {money(group.mainBranch.settledPayableBalance)}
                                </span>
                              </div>

                              {group.mainBranch.settledPayableBalance > 0 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleSelectBranchForPayout(group.mainBranch!.branchId)
                                  }
                                  className="btn btn-primary text-[11px] py-1 px-2.5 inline-flex items-center gap-1 shadow-xs"
                                >
                                  Disburse <ArrowRight className="size-3" />
                                </button>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="p-2.5 rounded-lg border border-dashed border-[var(--border)] text-muted text-xs">
                            No active Main Campus found for this institute.
                          </div>
                        )}

                        {/* 2. Sub-Branches Rows (Indented with connector) */}
                        {group.subBranches.length > 0 && (
                          <div className="pl-3 sm:pl-5 border-l-2 border-indigo-200 dark:border-indigo-900/60 ml-2 sm:ml-4 space-y-2">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-muted block pt-1">
                              Satellite Sub-Campuses ({group.subBranches.length})
                            </span>
                            {group.subBranches.map((sub) => (
                              <div
                                key={sub.branchId}
                                className={`p-2.5 sm:p-3 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-2 text-xs transition ${
                                  sub.settledPayableBalance > 0
                                    ? "border-emerald-300 dark:border-emerald-800 bg-emerald-50/20 dark:bg-emerald-950/15"
                                    : "border-[var(--border)] bg-[var(--surface-2)]/30"
                                }`}
                              >
                                <div className="space-y-0.5">
                                  <div className="flex items-center gap-2">
                                    <span className="font-semibold text-foreground text-xs">
                                      {sub.branchName}
                                    </span>
                                    <Badge tone="neutral" className="text-[9px]">
                                      SUB-BRANCH
                                    </Badge>
                                    {sub.parentBranchName && (
                                      <span className="text-[10px] text-muted">
                                        (Parent: {sub.parentBranchName})
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[10px] text-muted">
                                    Collector:{" "}
                                    <span className="font-mono">
                                      {sub.collectorCode || "Not Configured"}
                                    </span>{" "}
                                    &bull; Students: {sub.studentCount}
                                  </p>
                                  {sub.bankAccount && (
                                    <p className="text-[10px] text-muted font-mono">
                                      A/C: {sub.bankAccount} &bull; IFSC: {sub.bankIfsc}
                                    </p>
                                  )}
                                </div>

                                <div className="flex md:flex-col items-center md:items-end justify-between gap-1.5 shrink-0">
                                  <span
                                    className={`text-xs font-bold ${
                                      sub.settledPayableBalance > 0
                                        ? "text-emerald-700 dark:text-emerald-400 font-extrabold"
                                        : "text-muted"
                                    }`}
                                  >
                                    {money(sub.settledPayableBalance)}
                                  </span>

                                  {sub.settledPayableBalance > 0 && (
                                    <button
                                      type="button"
                                      onClick={() => handleSelectBranchForPayout(sub.branchId)}
                                      className="btn btn-primary text-[10px] py-0.5 px-2 inline-flex items-center gap-1 shadow-xs"
                                    >
                                      Disburse <ArrowRight className="size-2.5" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </Card>
      </div>

      {/* Right Column (1 Col): Interactive Manual Payout Action Form */}
      <div id="payout-form-section" className="space-y-4">
        <Card className="p-5 shadow-sm border-[var(--border)]">
          <CardHeader
            title="Disburse Manual Payout"
            description="Record a simulated bank transfer to a school campus operating account."
          />

          <div className="mt-4">
            <ActionForm
              action={recordManualPlatformPayoutAction}
              submitLabel="Record & Disburse Payout"
              pendingLabel="Recording Payout…"
            >
              <div className="space-y-4 text-xs">
                {/* 1. Select Campus with Optgroups */}
                <div>
                  <label className="form-label required block mb-1">Select Campus</label>
                  <select
                    name="branchId"
                    required
                    value={selectedBranchId}
                    onChange={(e) => handleBranchChange(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                  >
                    {/* Campuses with Available Balance First */}
                    <optgroup label="Campuses with Available Balance (> ₹0)">
                      {allBranches
                        .filter((b) => b.settledPayableBalance > 0)
                        .map((b) => (
                          <option key={b.branchId} value={b.branchId}>
                            {b.tenantName} — {b.branchName} ({b.branchType}) &bull; Available: {money(b.settledPayableBalance)}
                          </option>
                        ))}
                    </optgroup>

                    {/* Zero Balance Campuses */}
                    <optgroup label="Other Campuses (₹0 Balance)">
                      {allBranches
                        .filter((b) => b.settledPayableBalance === 0)
                        .map((b) => (
                          <option key={b.branchId} value={b.branchId}>
                            {b.tenantName} — {b.branchName} ({b.branchType}) &bull; ₹0
                          </option>
                        ))}
                    </optgroup>
                  </select>
                </div>

                {/* Selected Campus Live Card & Bank Helper */}
                {selectedBranch && (
                  <div className="p-3 rounded-xl bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/80 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-foreground text-xs">
                        {selectedBranch.tenantName}
                      </span>
                      <Badge tone={selectedBranch.branchType === "MAIN" ? "brand" : "neutral"} className="text-[9px]">
                        {selectedBranch.branchType}
                      </Badge>
                    </div>

                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-muted">Settled Payable:</span>
                      <span className="font-extrabold text-indigo-700 dark:text-indigo-400">
                        {money(selectedBranch.settledPayableBalance)}
                      </span>
                    </div>

                    {selectedBranch.bankAccount && (
                      <div className="text-[10px] text-muted pt-1 border-t border-indigo-200/60 dark:border-indigo-900/40">
                        <p className="font-medium text-foreground">
                          {selectedBranch.bankBankName || "Bank Account"}
                        </p>
                        <p className="font-mono">
                          A/C: {selectedBranch.bankAccount} &bull; IFSC: {selectedBranch.bankIfsc}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Hidden TenantId helper */}
                {selectedBranch && (
                  <input
                    type="hidden"
                    name="tenantId"
                    value={selectedBranch.tenantId}
                  />
                )}

                {/* 2. Amount in ₹ with Quick Fill Buttons */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="form-label required block">
                      Payout Amount (₹)
                    </label>
                    {selectedBranch && selectedBranch.settledPayableBalance > 0 && (
                      <div className="flex items-center gap-1 text-[10px]">
                        <button
                          type="button"
                          onClick={() =>
                            setPayoutAmount(
                              Math.floor(selectedBranch.settledPayableBalance / 100).toString()
                            )
                          }
                          className="px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 font-semibold hover:bg-indigo-200"
                        >
                          100% Full ({money(selectedBranch.settledPayableBalance)})
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setPayoutAmount(
                              Math.floor(selectedBranch.settledPayableBalance / 200).toString()
                            )
                          }
                          className="px-1.5 py-0.5 rounded bg-[var(--surface-3)] text-muted hover:text-foreground font-medium"
                        >
                          50%
                        </button>
                      </div>
                    )}
                  </div>

                  <input
                    name="amount"
                    type="number"
                    step="1"
                    required
                    value={payoutAmount}
                    onChange={(e) => setPayoutAmount(e.target.value)}
                    placeholder="e.g. 35000"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs focus:ring-2 focus:ring-indigo-500 outline-none font-mono font-bold text-foreground"
                  />
                  <p className="text-[10px] text-muted mt-1">
                    Automatically populated from available campus balance. Editable for partial tranches.
                  </p>
                </div>

                {/* 3. Bank Settlement UTR */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="form-label required block">
                      Bank Settlement UTR
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setPayoutUtr(`SBIN${Math.floor(10000000 + Math.random() * 90000000)}`)
                      }
                      className="text-[10px] text-indigo-600 hover:text-indigo-700 font-medium inline-flex items-center gap-0.5"
                    >
                      <RefreshCw className="size-2.5" /> Regenerate
                    </button>
                  </div>
                  <input
                    name="payoutUtr"
                    type="text"
                    required
                    value={payoutUtr}
                    onChange={(e) => setPayoutUtr(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs focus:ring-2 focus:ring-indigo-500 outline-none font-mono font-medium"
                  />
                </div>

                {/* 4. Treasury Notes */}
                <div>
                  <label className="form-label block mb-1">Treasury Notes</label>
                  <input
                    name="notes"
                    type="text"
                    placeholder="e.g. Q1 student collections tranche 1"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
              </div>
            </ActionForm>
          </div>
        </Card>
      </div>
    </div>
  );
}
