"use client";

import { useState } from "react";
import { Banknote, CheckCircle2, CreditCard, X } from "lucide-react";
import { recordFeePaymentAction } from "@/actions/operations";
import { ActionForm } from "@/components/ui/action-form";
import { money } from "@/lib/format";

export function QuickCollectFeeModal({
  invoiceId,
  invoiceNumber,
  studentName,
  admissionNo,
  outstandingPaise,
}: {
  invoiceId: string;
  invoiceNumber: string;
  studentName: string;
  admissionNo: string;
  outstandingPaise: number;
}) {
  const [isOpen, setIsOpen] = useState(false);

  if (outstandingPaise <= 0) return null;

  const defaultRupees = Math.round(outstandingPaise / 100);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400"
      >
        <Banknote className="size-3.5" />
        Collect
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="relative w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <div>
                <h3 className="font-semibold text-[var(--text)]">Quick Fee Collection</h3>
                <p className="text-xs text-muted">
                  Invoice <span className="font-mono font-medium">{invoiceNumber}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-lg p-1 text-muted hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-4 rounded-xl bg-[var(--surface-subtle)] p-3 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-muted">Student</span>
                <span className="font-medium text-[var(--text)]">
                  {studentName} ({admissionNo})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Outstanding Balance</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {money(outstandingPaise)}
                </span>
              </div>
            </div>

            <div className="mt-4">
              <ActionForm
                action={recordFeePaymentAction}
                submitLabel="Record Payment"
                pendingLabel="Recording…"
                footer={
                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    className="btn btn-secondary w-full"
                  >
                    Cancel
                  </button>
                }
              >
                <input type="hidden" name="invoiceId" value={invoiceId} />

                <div className="space-y-3">
                  <div>
                    <label htmlFor="quick-fee-amount" className="block text-xs font-medium text-[var(--text)] mb-1">
                      Payment Amount (₹) *
                    </label>
                    <input
                      id="quick-fee-amount"
                      name="amount"
                      type="number"
                      step="1"
                      min="1"
                      max={defaultRupees}
                      defaultValue={defaultRupees}
                      className="input w-full font-mono text-base font-semibold"
                      required
                    />
                  </div>

                  <div>
                    <label htmlFor="quick-fee-method" className="block text-xs font-medium text-[var(--text)] mb-1">
                      Payment Method *
                    </label>
                    <select
                      id="quick-fee-method"
                      name="method"
                      className="select w-full"
                      defaultValue="CASH"
                      required
                    >
                      <option value="CASH">Cash</option>
                      <option value="UPI">UPI</option>
                      <option value="BANK_TRANSFER">Bank Transfer / NEFT</option>
                      <option value="CHEQUE">Cheque</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="quick-fee-ref" className="block text-xs font-medium text-[var(--text)] mb-1">
                      Reference / Note (Optional)
                    </label>
                    <input
                      id="quick-fee-ref"
                      name="reference"
                      type="text"
                      className="input w-full"
                      placeholder="e.g. UTR / Cheque No / Slip No"
                    />
                  </div>
                </div>
              </ActionForm>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
