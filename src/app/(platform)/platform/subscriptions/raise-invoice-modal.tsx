"use client";

import { useState } from "react";
import { Plus, ReceiptText, Sparkles, X, Check, Calculator } from "lucide-react";
import { createCustomInvoiceWithGstAction } from "@/actions/platform";

interface InstituteOption {
  id: string;
  name: string;
  city?: string | null;
  planName?: string | null;
}

export function RaiseInvoiceModal({ institutes }: { institutes: InstituteOption[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [tenantId, setTenantId] = useState(institutes[0]?.id ?? "");
  const [charges, setCharges] = useState<string>("5000");
  const [gstType, setGstType] = useState<string>("18");
  const [customGst, setCustomGst] = useState<string>("18");
  const [description, setDescription] = useState<string>("Platform subscription charges");
  const [dueDays, setDueDays] = useState<number>(7);
  const [notes, setNotes] = useState<string>("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const effectiveGstPercent =
    gstType === "custom" ? Math.max(0, Number(customGst) || 0) : Number(gstType);

  const numCharges = Math.max(0, Number(charges) || 0);
  const calculatedTax = Math.round(numCharges * (effectiveGstPercent / 100));
  const calculatedTotal = numCharges + calculatedTax;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      const formData = new FormData();
      formData.set("tenantId", tenantId);
      formData.set("charges", String(numCharges));
      formData.set("gstPercent", String(effectiveGstPercent));
      formData.set("description", description);
      formData.set("dueDays", String(dueDays));
      formData.set("notes", notes);

      const res = await createCustomInvoiceWithGstAction(null, formData);
      if (res?.error) {
        setError(res.error);
      } else {
        setSuccess(res?.success || "Invoice raised successfully!");
        setTimeout(() => {
          setIsOpen(false);
          setSuccess(null);
        }, 1500);
      }
    } catch (err: any) {
      setError(err?.message || "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setSuccess(null);
          setIsOpen(true);
        }}
        className="btn btn-primary"
      >
        <Plus className="size-4" /> Raise invoice with GST
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div
            className="card relative w-full max-w-lg overflow-hidden border border-[var(--border)] bg-[var(--surface)] shadow-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-4 border-b border-[var(--border)]">
              <div className="flex items-center gap-2.5">
                <div className="grid size-9 place-items-center rounded-xl bg-[var(--brand)] text-white shadow-xs">
                  <ReceiptText className="size-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-[var(--foreground)]">
                    Raise Invoice & Set Charges
                  </h3>
                  <p className="text-xs text-muted">
                    Generate an official platform invoice with custom charges & GST
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-lg p-1 text-muted hover:bg-[var(--surface-2)] hover:text-[var(--text)] transition"
              >
                <X className="size-5" />
              </button>
            </div>

            {error && (
              <div className="mt-4 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/10 p-3 text-xs text-[var(--danger)]">
                {error}
              </div>
            )}

            {success && (
              <div className="mt-4 rounded-xl border border-[var(--success)]/30 bg-[var(--success)]/10 p-3 text-xs text-[var(--success)] flex items-center gap-2">
                <Check className="size-4" /> {success}
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              {/* Institute Select */}
              <div>
                <label className="block text-xs font-medium text-[var(--foreground)] mb-1">
                  Target Institute <span className="text-[var(--danger)]">*</span>
                </label>
                <select
                  required
                  value={tenantId}
                  onChange={(e) => setTenantId(e.target.value)}
                  className="select w-full"
                >
                  {institutes.map((inst) => (
                    <option key={inst.id} value={inst.id}>
                      {inst.name} {inst.city ? `(${inst.city})` : ""} {inst.planName ? `— ${inst.planName}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              {/* Charges and GST Selection */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--foreground)] mb-1">
                    Base Charges (₹) <span className="text-[var(--danger)]">*</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    required
                    value={charges}
                    onChange={(e) => setCharges(e.target.value)}
                    placeholder="e.g. 5000"
                    className="input w-full font-mono text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--foreground)] mb-1">
                    GST Option <span className="text-[var(--danger)]">*</span>
                  </label>
                  <select
                    value={gstType}
                    onChange={(e) => setGstType(e.target.value)}
                    className="select w-full"
                  >
                    <option value="18">18% GST (Standard)</option>
                    <option value="12">12% GST (Concessional)</option>
                    <option value="5">5% GST (Reduced)</option>
                    <option value="0">0% GST (Exempt / SEZ)</option>
                    <option value="custom">Custom GST %</option>
                  </select>
                </div>
              </div>

              {gstType === "custom" && (
                <div>
                  <label className="block text-xs font-medium text-[var(--foreground)] mb-1">
                    Custom GST Percentage (%)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={customGst}
                    onChange={(e) => setCustomGst(e.target.value)}
                    className="input w-full font-mono"
                    placeholder="Enter GST %"
                  />
                </div>
              )}

              {/* Real-time Calculation Breakdown Card */}
              <div className="rounded-xl border border-[var(--brand)]/20 bg-[var(--brand-soft)]/20 p-3.5 space-y-1.5">
                <div className="flex items-center justify-between text-xs text-muted">
                  <span className="flex items-center gap-1">
                    <Calculator className="size-3.5 text-[var(--brand)]" /> Base Charges
                  </span>
                  <span className="font-mono text-[var(--foreground)] font-medium">
                    ₹{numCharges.toLocaleString("en-IN")}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-muted">
                  <span>GST ({effectiveGstPercent}%)</span>
                  <span className="font-mono text-[var(--foreground)] font-medium">
                    ₹{calculatedTax.toLocaleString("en-IN")}
                  </span>
                </div>
                <div className="pt-2 border-t border-[var(--border)] flex items-center justify-between text-sm font-semibold text-[var(--foreground)]">
                  <span>Total Payable</span>
                  <span className="font-mono text-base text-[var(--brand)]">
                    ₹{calculatedTotal.toLocaleString("en-IN")}
                  </span>
                </div>
              </div>

              {/* Description & Due Date */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-[var(--foreground)] mb-1">
                    Line Item / Description
                  </label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="e.g. Annual Institute License"
                    className="input w-full text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--foreground)] mb-1">
                    Payment Due
                  </label>
                  <select
                    value={dueDays}
                    onChange={(e) => setDueDays(Number(e.target.value))}
                    className="select w-full text-xs"
                  >
                    <option value={7}>In 7 days</option>
                    <option value={14}>In 14 days</option>
                    <option value={30}>In 30 days</option>
                  </select>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-medium text-[var(--foreground)] mb-1">
                  Internal Notes (optional)
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Special institutional discount approved"
                  className="input w-full text-xs"
                />
              </div>

              {/* Actions */}
              <div className="pt-3 border-t border-[var(--border)] flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  disabled={loading}
                  className="btn btn-secondary text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading || numCharges <= 0}
                  className="btn btn-primary text-xs"
                >
                  {loading ? "Generating invoice…" : "Generate & Raise Invoice"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
