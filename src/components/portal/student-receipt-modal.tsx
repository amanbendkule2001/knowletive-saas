"use client";

import { useState } from "react";
import { Download, FileText, Printer, ShieldCheck, X } from "lucide-react";
import { money, date } from "@/lib/format";

export interface ReceiptData {
  receiptNumber: string;
  date: Date | string;
  studentName: string;
  admissionNo: string;
  className: string;
  tenantName: string;
  branchName?: string | null;
  payerName: string;
  amount: number; // in paise
  method: string;
  reference: string;
  description: string;
  status: string;
}

export function StudentReceiptModal({
  receipt,
  triggerLabel = "View Receipt",
}: {
  receipt: ReceiptData;
  triggerLabel?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);

  function handlePrint() {
    window.print();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-1 text-[11px] font-medium text-brand hover:underline"
      >
        <FileText className="size-3" /> {triggerLabel}
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm print:p-0 print:bg-white">
          <div className="relative w-full max-w-xl bg-white text-slate-900 rounded-2xl shadow-2xl border border-slate-200 overflow-hidden print:border-none print:shadow-none print:max-w-none">
            {/* Modal Action Bar (Hidden on print) */}
            <div className="flex items-center justify-between px-6 py-3 bg-slate-50 border-b border-slate-200 print:hidden">
              <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                Official Fee Receipt (Demo)
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePrint}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition"
                >
                  <Printer className="size-3.5" /> Print / PDF
                </button>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>

            {/* Printable Receipt Body */}
            <div className="p-8 space-y-6">
              {/* Receipt Header */}
              <div className="flex justify-between items-start pb-6 border-b border-slate-200">
                <div>
                  <h2 className="text-xl font-bold tracking-tight text-slate-900">
                    {receipt.tenantName}
                  </h2>
                  {receipt.branchName && (
                    <p className="text-xs text-slate-600 font-medium mt-0.5">
                      {receipt.branchName}
                    </p>
                  )}
                  <p className="text-[11px] text-slate-500 mt-1">
                    Recognized & Affiliated Educational Institution
                  </p>
                </div>
                <div className="text-right">
                  <div className="inline-block px-2.5 py-1 bg-emerald-50 border border-emerald-200 rounded text-[11px] font-bold text-emerald-700 uppercase tracking-wider">
                    {receipt.status}
                  </div>
                  <p className="text-xs font-mono font-semibold text-slate-700 mt-1.5">
                    {receipt.receiptNumber}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Date: {date(receipt.date)}
                  </p>
                </div>
              </div>

              {/* Student & Payer Info Grid */}
              <div className="grid grid-cols-2 gap-4 text-xs bg-slate-50 p-4 rounded-xl border border-slate-100">
                <div>
                  <span className="text-[10px] uppercase font-semibold text-slate-500 block">
                    Student Details
                  </span>
                  <p className="font-bold text-slate-800 text-sm mt-0.5">
                    {receipt.studentName}
                  </p>
                  <p className="text-slate-600 mt-0.5">Adm No: {receipt.admissionNo}</p>
                  <p className="text-slate-600">Class: {receipt.className}</p>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-semibold text-slate-500 block">
                    Payer & Transaction Details
                  </span>
                  <p className="font-semibold text-slate-800 mt-0.5">{receipt.payerName}</p>
                  <p className="text-slate-600 mt-0.5">
                    Mode: <span className="font-medium text-slate-800">{receipt.method}</span>
                  </p>
                  <p className="text-slate-600 font-mono text-[11px] truncate">
                    Ref: {receipt.reference}
                  </p>
                </div>
              </div>

              {/* Payment Line Item Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-100 text-slate-700 border-b border-slate-200 font-semibold">
                    <tr>
                      <th className="py-2.5 px-4 text-left">Description</th>
                      <th className="py-2.5 px-4 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <tr>
                      <td className="py-3 px-4 font-medium text-slate-800">
                        {receipt.description}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-slate-900">
                        {money(receipt.amount)}
                      </td>
                    </tr>
                  </tbody>
                  <tfoot className="bg-slate-50 font-bold border-t border-slate-200">
                    <tr>
                      <td className="py-2.5 px-4 text-slate-700">Total Settled</td>
                      <td className="py-2.5 px-4 text-right text-sm text-slate-900">
                        {money(receipt.amount)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Footer Stamp & Security Verification */}
              <div className="pt-4 flex items-center justify-between border-t border-slate-200 text-[11px] text-slate-500">
                <div className="flex items-center gap-1.5 text-emerald-700 font-medium">
                  <ShieldCheck className="size-4" />
                  <span>Jodo Gateway Verified Settlement &bull; Simulation Mode</span>
                </div>
                <div className="text-right">
                  <p className="font-serif italic text-slate-700">Accounts Department</p>
                  <p className="text-[10px] text-slate-400">Computer Generated Receipt</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
