"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { initiateDemoCheckoutAction } from "@/actions/installments";
import { Loader2, PlayCircle } from "lucide-react";

export function DemoCheckoutButton({
  studentId,
  installmentId,
  amountRupees,
  label = "Pay with DEMO Gateway →",
}: {
  studentId: string;
  installmentId: string;
  amountRupees: number;
  label?: string;
}) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleClick() {
    setLoading(true);
    const fd = new FormData();
    fd.append("studentId", studentId);
    fd.append("installmentIds", installmentId);
    fd.append("sourceInstallmentId", installmentId);
    fd.append("amount", amountRupees.toString());

    try {
      const res = await initiateDemoCheckoutAction({}, fd);
      if (res.success && res.data?.checkoutUrl) {
        router.push(res.data.checkoutUrl);
      } else {
        alert(res.error || "Failed to start demo payment.");
        setLoading(false);
      }
    } catch (e: any) {
      alert(e.message || "Error initiating checkout");
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300 underline disabled:opacity-50"
    >
      {loading ? (
        <>
          <Loader2 className="size-3 animate-spin" /> Launching…
        </>
      ) : (
        <>
          <PlayCircle className="size-3" /> {label}
        </>
      )}
    </button>
  );
}
