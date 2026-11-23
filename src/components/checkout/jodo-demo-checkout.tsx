"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  CreditCard,
  ExternalLink,
  Lock,
  QrCode,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sparkles,
  User,
  Wallet,
  XCircle,
} from "lucide-react";
import { money, date } from "@/lib/format";
import { submitDemoPaymentOutcomeAction } from "@/actions/installments";
import { StudentReceiptModal, type ReceiptData } from "@/components/portal/student-receipt-modal";

export interface JodoCheckoutProps {
  sessionToken: string;
  amountPaise: number;
  studentName: string;
  admissionNo: string;
  className: string;
  sectionName: string;
  tenantName: string;
  branchName: string;
  expiresAt: Date | string;
  initialStatus: string;
  existingTransaction?: {
    reference: string;
    amount: number;
    createdAt: Date | string;
  } | null;
  upiQrDataUrl: string;
  installmentTitle?: string;
}

type PaymentTab = "upi" | "card" | "netbanking" | "flex";
type ProcessingState = "idle" | "processing" | "success" | "failed" | "pending";

export function JodoDemoCheckout(props: JodoCheckoutProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<PaymentTab>("upi");
  const [processState, setProcessState] = useState<ProcessingState>(
    props.initialStatus === "SUCCESS"
      ? "success"
      : props.initialStatus === "FAILED"
      ? "failed"
      : props.initialStatus === "PENDING"
      ? "pending"
      : "idle"
  );
  const [loadingOutcome, setLoadingOutcome] = useState<string | null>(null);
  const [completedRef, setCompletedRef] = useState<string>(
    props.existingTransaction?.reference || `JODO-DEMO-UTR-${Math.floor(100000 + Math.random() * 900000)}`
  );
  const [selectedFlexTenure, setSelectedFlexTenure] = useState<number>(3);
  const [customVpa, setCustomVpa] = useState("");
  const [selectedBank, setSelectedBank] = useState("HDFC");
  const [cardNumber, setCardNumber] = useState("4111 2222 3333 4444");
  const [cardExpiry, setCardExpiry] = useState("12/28");
  const [cardCvv, setCardCvv] = useState("123");
  const [cardHolder, setCardHolder] = useState("Demo Guardian");

  const amountRupees = props.amountPaise / 100;

  async function handleSimulatePayment(outcome: "SUCCESS" | "FAILED" | "PENDING") {
    setProcessState("processing");
    setLoadingOutcome(outcome);

    // Simulate realistic network roundtrip to Jodo simulator
    await new Promise((resolve) => setTimeout(resolve, 1400));

    const fd = new FormData();
    fd.append("sessionToken", props.sessionToken);
    fd.append("outcome", outcome);
    const generatedUtr = `JODO-DEMO-UTR-${Math.floor(1000000000 + Math.random() * 9000000000)}`;
    fd.append("customUtr", generatedUtr);

    try {
      const res = await submitDemoPaymentOutcomeAction({}, fd);
      if (res.success || outcome !== "FAILED") {
        setCompletedRef(generatedUtr);
        if (outcome === "SUCCESS") {
          setProcessState("success");
        } else if (outcome === "FAILED") {
          setProcessState("failed");
        } else {
          setProcessState("pending");
        }
      } else {
        setProcessState("failed");
      }
    } catch {
      setProcessState("failed");
    } finally {
      setLoadingOutcome(null);
    }
  }

  // Pre-configured receipt data for the receipt modal
  const receiptData: ReceiptData = {
    receiptNumber: `RCPT-JODO-${completedRef.slice(-6)}`,
    date: new Date(),
    studentName: props.studentName,
    admissionNo: props.admissionNo,
    className: `${props.className}${props.sectionName}`,
    tenantName: props.tenantName,
    branchName: props.branchName,
    payerName: cardHolder || "Guardian Payer",
    amount: props.amountPaise,
    method:
      activeTab === "upi"
        ? "Jodo Pay (UPI)"
        : activeTab === "card"
        ? "Jodo Pay (Card)"
        : activeTab === "netbanking"
        ? `Jodo Pay (Net Banking - ${selectedBank})`
        : `Jodo Flex (${selectedFlexTenure}-Month EMI)`,
    reference: completedRef,
    description: props.installmentTitle || "School Fee Installment",
    status: "SETTLED",
  };

  return (
    <div className="min-h-dvh bg-slate-900/5 dark:bg-slate-950 py-8 px-4 sm:px-6">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Top Sandbox Notice Banner */}
        <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/90 dark:bg-amber-950/40 p-3.5 flex items-start gap-3">
          <ShieldAlert className="size-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-950 dark:text-amber-200">
            <span className="font-bold tracking-wide uppercase">
              Jodo Demo Checkout &bull; Simulation Mode
            </span>
            <p className="text-[11px] text-amber-800/90 dark:text-amber-300/80 mt-0.5">
              Simulated payment gateway environment for management demonstration. No real bank debits or live card authorizations take place.
            </p>
          </div>
        </div>

        {/* Jodo-Themed Gateway Card */}
        <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-xl border border-slate-200/80 dark:border-slate-800 overflow-hidden">
          {/* Header Bar */}
          <div className="bg-gradient-to-r from-indigo-700 via-purple-700 to-indigo-800 p-6 text-white">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-xl bg-white/10 backdrop-blur-md flex items-center justify-center font-bold text-white text-lg border border-white/20">
                  J
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-base tracking-tight">jodo</span>
                    <span className="text-[10px] uppercase font-semibold bg-white/20 px-2 py-0.5 rounded text-white/90">
                      Sandbox Demo
                    </span>
                  </div>
                  <p className="text-[11px] text-indigo-100">
                    Trusted Education Payment Infrastructure
                  </p>
                </div>
              </div>

              <div className="text-right">
                <span className="text-[11px] text-indigo-200 block">Total Amount</span>
                <span className="text-2xl font-bold text-white">
                  {money(props.amountPaise)}
                </span>
              </div>
            </div>

            {/* Sub-Header Institute & Student Summary */}
            <div className="mt-4 pt-3.5 border-t border-white/15 flex flex-wrap items-center justify-between gap-2 text-xs text-indigo-100">
              <div className="flex items-center gap-1.5">
                <Building2 className="size-3.5 text-indigo-300" />
                <span className="font-medium text-white">{props.tenantName}</span>
                <span className="text-indigo-300">&bull; {props.branchName}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <User className="size-3.5 text-indigo-300" />
                <span className="font-medium text-white">{props.studentName}</span>
                <span className="text-indigo-300">({props.admissionNo})</span>
              </div>
            </div>
          </div>

          {/* Conditional Display: Processing vs. Result vs. Method Selection */}
          {processState === "processing" ? (
            <div className="p-12 text-center space-y-4">
              <div className="relative mx-auto size-16">
                <div className="absolute inset-0 rounded-full border-4 border-indigo-200 dark:border-indigo-900 border-t-indigo-600 animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center font-bold text-indigo-600 text-sm">
                  J
                </div>
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Simulating Jodo Gateway Authorization…
                </h3>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  Communicating with simulated bank switches & verifying transaction limits.
                </p>
              </div>
              <div className="inline-flex items-center gap-1.5 text-[11px] text-indigo-600 dark:text-indigo-400 font-medium bg-indigo-50 dark:bg-indigo-950/40 px-3 py-1.5 rounded-full border border-indigo-200 dark:border-indigo-900">
                <Lock className="size-3" /> 256-bit SSL encrypted simulation
              </div>
            </div>
          ) : processState === "success" ? (
            /* SUCCESS SCREEN */
            <div className="p-8 text-center space-y-5">
              <div className="mx-auto size-16 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center border-4 border-emerald-50 dark:border-emerald-900/40">
                <CheckCircle2 className="size-9" />
              </div>

              <div>
                <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider block">
                  Payment Successful
                </span>
                <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                  {money(props.amountPaise)} Settled
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Your simulated fee payment has been confirmed by the Jodo Gateway.
                </p>
              </div>

              {/* Transaction Detail Box */}
              <div className="max-w-md mx-auto text-xs bg-slate-50 dark:bg-slate-800/60 rounded-xl p-4 border border-slate-200 dark:border-slate-700/60 text-left space-y-2">
                <div className="flex justify-between py-1 border-b border-slate-200 dark:border-slate-700">
                  <span className="text-slate-500">Jodo Reference ID</span>
                  <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                    {completedRef}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200 dark:border-slate-700">
                  <span className="text-slate-500">Student</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {props.studentName} ({props.admissionNo})
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200 dark:border-slate-700">
                  <span className="text-slate-500">Campus / Branch</span>
                  <span className="font-medium text-slate-800 dark:text-slate-200">
                    {props.branchName}
                  </span>
                </div>
                <div className="flex justify-between pt-1">
                  <span className="text-slate-500">Status</span>
                  <span className="inline-flex items-center gap-1 font-bold text-emerald-600">
                    <CheckCircle2 className="size-3" /> SETTLED IN DEMO STORE
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-3">
                <StudentReceiptModal receipt={receiptData} triggerLabel="Download Official Receipt" />
                <Link
                  href="/portal/fees"
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-semibold text-xs hover:bg-slate-800 transition"
                >
                  Return to Fees Portal
                </Link>
              </div>
            </div>
          ) : processState === "failed" ? (
            /* FAILED SCREEN */
            <div className="p-8 text-center space-y-5">
              <div className="mx-auto size-16 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center border-4 border-rose-50 dark:border-rose-900/40">
                <XCircle className="size-9" />
              </div>

              <div>
                <span className="text-xs font-semibold text-rose-600 dark:text-rose-400 uppercase tracking-wider block">
                  Simulated Payment Failed
                </span>
                <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                  Transaction Declined by Bank
                </h2>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  Reason: Insufficient demo balance or customer OTP verification timed out.
                </p>
              </div>

              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setProcessState("idle")}
                  className="px-5 py-2 rounded-xl bg-indigo-600 text-white font-semibold text-xs hover:bg-indigo-700 transition flex items-center gap-1.5"
                >
                  <RotateCcw className="size-3.5" /> Try Another Method
                </button>
                <Link
                  href="/portal/fees"
                  className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                >
                  Cancel
                </Link>
              </div>
            </div>
          ) : processState === "pending" ? (
            /* PENDING SCREEN */
            <div className="p-8 text-center space-y-5">
              <div className="mx-auto size-16 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center border-4 border-amber-50 dark:border-amber-900/40">
                <Clock className="size-9" />
              </div>

              <div>
                <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wider block">
                  Payment Under Review
                </span>
                <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                  Awaiting Simulated Bank Clearing
                </h2>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  Your bank has received the transfer request. The status will update automatically upon webhook confirmation.
                </p>
              </div>

              <div className="flex items-center justify-center gap-3 pt-2">
                <Link
                  href="/portal/fees"
                  className="px-5 py-2 rounded-xl bg-slate-900 text-white font-semibold text-xs hover:bg-slate-800 transition"
                >
                  Return to Portal
                </Link>
              </div>
            </div>
          ) : (
            /* MAIN PAYMENT SELECTION WORKFLOW */
            <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-slate-200 dark:divide-slate-800">
              {/* Payment Methods Left Sidebar */}
              <div className="p-4 bg-slate-50 dark:bg-slate-900/50 space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-3 block mb-2">
                  Select Payment Option
                </span>

                <button
                  type="button"
                  onClick={() => setActiveTab("upi")}
                  className={`w-full text-left px-3.5 py-3 rounded-xl flex items-center justify-between transition ${
                    activeTab === "upi"
                      ? "bg-white dark:bg-slate-800 shadow-sm border border-slate-200 dark:border-slate-700 text-indigo-600 dark:text-indigo-400 font-bold"
                      : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 font-medium"
                  }`}
                >
                  <div className="flex items-center gap-2.5 text-xs">
                    <Smartphone className="size-4 text-indigo-600 shrink-0" />
                    <span>Instant UPI (Jodo Pay)</span>
                  </div>
                  <span className="text-[9px] font-bold uppercase bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 rounded">
                    Fastest
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab("card")}
                  className={`w-full text-left px-3.5 py-3 rounded-xl flex items-center justify-between transition ${
                    activeTab === "card"
                      ? "bg-white dark:bg-slate-800 shadow-sm border border-slate-200 dark:border-slate-700 text-indigo-600 dark:text-indigo-400 font-bold"
                      : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 font-medium"
                  }`}
                >
                  <div className="flex items-center gap-2.5 text-xs">
                    <CreditCard className="size-4 text-indigo-600 shrink-0" />
                    <span>Debit / Credit Card</span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab("netbanking")}
                  className={`w-full text-left px-3.5 py-3 rounded-xl flex items-center justify-between transition ${
                    activeTab === "netbanking"
                      ? "bg-white dark:bg-slate-800 shadow-sm border border-slate-200 dark:border-slate-700 text-indigo-600 dark:text-indigo-400 font-bold"
                      : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 font-medium"
                  }`}
                >
                  <div className="flex items-center gap-2.5 text-xs">
                    <Building2 className="size-4 text-indigo-600 shrink-0" />
                    <span>Net Banking</span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab("flex")}
                  className={`w-full text-left px-3.5 py-3 rounded-xl flex items-center justify-between transition ${
                    activeTab === "flex"
                      ? "bg-indigo-50/80 dark:bg-indigo-950/40 shadow-sm border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 font-bold"
                      : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 font-medium"
                  }`}
                >
                  <div className="flex items-center gap-2.5 text-xs">
                    <Sparkles className="size-4 text-indigo-600 shrink-0" />
                    <span>Jodo Flex (Monthly EMI)</span>
                  </div>
                  <span className="text-[9px] font-bold uppercase bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded">
                    0% EMI
                  </span>
                </button>
              </div>

              {/* Right 2 Columns: Selected Tab Details & Simulation Buttons */}
              <div className="md:col-span-2 p-6 space-y-5">
                {/* 1. UPI Tab Content */}
                {activeTab === "upi" && (
                  <div className="space-y-4">
                    <div>
                      <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                        <QrCode className="size-4 text-indigo-600" /> Scan QR or Enter UPI ID
                      </h4>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Scan with Google Pay, PhonePe, Paytm, or BHIM.
                      </p>
                    </div>

                    <div className="flex flex-col sm:flex-row items-center gap-6 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                      <div className="bg-white p-2.5 rounded-xl border border-slate-200 shadow-sm shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={props.upiQrDataUrl}
                          alt="Jodo UPI QR Code"
                          className="size-36 object-contain"
                        />
                      </div>
                      <div className="text-xs space-y-2 text-center sm:text-left">
                        <div className="space-y-0.5">
                          <span className="text-slate-400 text-[10px] uppercase font-bold block">
                            Merchant VPA
                          </span>
                          <span className="font-mono font-semibold text-slate-800 dark:text-slate-200 select-all">
                            jodo.sunrise@hdfcbank
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 leading-relaxed">
                          Scan using any UPI app to simulate instantaneous settlement directly to Sunrise Public School.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* 2. Card Tab Content */}
                {activeTab === "card" && (
                  <div className="space-y-4 text-xs">
                    <div>
                      <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                        <CreditCard className="size-4 text-indigo-600" /> Credit / Debit Card (Demo)
                      </h4>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Test card numbers pre-filled for sandbox verification.
                      </p>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                          Card Number
                        </label>
                        <input
                          type="text"
                          value={cardNumber}
                          onChange={(e) => setCardNumber(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                            Valid Thru (MM/YY)
                          </label>
                          <input
                            type="text"
                            value={cardExpiry}
                            onChange={(e) => setCardExpiry(e.target.value)}
                            className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                          />
                        </div>
                        <div>
                          <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                            CVV
                          </label>
                          <input
                            type="password"
                            value={cardCvv}
                            onChange={(e) => setCardCvv(e.target.value)}
                            maxLength={4}
                            className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                          Cardholder Name
                        </label>
                        <input
                          type="text"
                          value={cardHolder}
                          onChange={(e) => setCardHolder(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* 3. Net Banking Tab */}
                {activeTab === "netbanking" && (
                  <div className="space-y-4 text-xs">
                    <div>
                      <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                        <Building2 className="size-4 text-indigo-600" /> Select Bank (Simulation)
                      </h4>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Choose your bank to simulate net banking redirection.
                      </p>
                    </div>

                    <div className="grid grid-cols-3 gap-2.5">
                      {["HDFC", "SBI", "ICICI", "Axis", "Kotak", "PNB"].map((bank) => (
                        <button
                          key={bank}
                          type="button"
                          onClick={() => setSelectedBank(bank)}
                          className={`p-3 rounded-xl border text-center font-bold text-xs transition ${
                            selectedBank === bank
                              ? "border-indigo-600 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400"
                              : "border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
                          }`}
                        >
                          {bank} Bank
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* 4. Jodo Flex Tab Content */}
                {activeTab === "flex" && (
                  <div className="space-y-4 text-xs">
                    <div className="rounded-xl bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-950/50 dark:to-purple-950/30 p-3.5 border border-indigo-200 dark:border-indigo-800">
                      <span className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider block">
                        Jodo Flex Zero-Cost EMI
                      </span>
                      <p className="text-xs text-indigo-950 dark:text-indigo-200 font-semibold mt-0.5">
                        Split ₹{amountRupees.toLocaleString("en-IN")} into flexible monthly installments with 0% interest.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <label className="font-semibold text-slate-700 dark:text-slate-300 block">
                        Select EMI Tenure:
                      </label>

                      <div className="grid grid-cols-3 gap-2.5">
                        {[
                          { months: 3, interest: "0% Interest", note: "Zero fee" },
                          { months: 6, interest: "0% Interest", note: "Zero fee" },
                          { months: 9, interest: "Low Interest", note: "Standard" },
                        ].map((plan) => {
                          const monthly = Math.round(amountRupees / plan.months);
                          const isSelected = selectedFlexTenure === plan.months;

                          return (
                            <button
                              key={plan.months}
                              type="button"
                              onClick={() => setSelectedFlexTenure(plan.months)}
                              className={`p-3 rounded-xl border text-left transition ${
                                isSelected
                                  ? "border-indigo-600 bg-indigo-50/70 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-200 shadow-sm"
                                  : "border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-600 dark:text-slate-400"
                              }`}
                            >
                              <span className="font-bold text-sm block">
                                ₹{monthly.toLocaleString("en-IN")}
                                <span className="text-[10px] font-normal text-slate-500">/mo</span>
                              </span>
                              <span className="text-[11px] font-semibold text-indigo-600 block mt-0.5">
                                {plan.months} Months
                              </span>
                              <span className="text-[10px] text-emerald-600 font-medium block">
                                {plan.interest}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* PRIMARY ACTION BUTTONS: SIMULATE OUTCOME */}
                <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
                  <button
                    type="button"
                    onClick={() => handleSimulatePayment("SUCCESS")}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-bold text-sm shadow-md transition flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 className="size-4" /> Pay {money(props.amountPaise)} &bull; Simulate SUCCESS
                  </button>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => handleSimulatePayment("FAILED")}
                      className="py-2 px-3 rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50/60 dark:bg-rose-950/20 text-rose-700 dark:text-rose-400 font-semibold hover:bg-rose-100 transition"
                    >
                      Simulate FAILED
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSimulatePayment("PENDING")}
                      className="py-2 px-3 rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/60 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 font-semibold hover:bg-amber-100 transition"
                    >
                      Simulate PENDING
                    </button>
                  </div>
                </div>

                {/* Footer Assurance */}
                <div className="flex items-center justify-center gap-2 text-[11px] text-slate-400 pt-1">
                  <ShieldCheck className="size-3.5 text-emerald-500" />
                  <span>Secured by Jodo Gateway &bull; ISO 27001 Certified &bull; RBI Regulated NBFC</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
