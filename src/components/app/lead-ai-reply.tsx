"use client";

import { useActionState, useState } from "react";
import { Sparkles, Copy, Check, Loader2 } from "lucide-react";
import { draftLeadReplyAction } from "@/actions/leads";
import type { FormState } from "@/lib/validation";

export function LeadAiReplyDraft({ leadId }: { leadId: string }) {
  const [state, formAction, pending] = useActionState<FormState & { reply?: string }, FormData>(
    draftLeadReplyAction,
    {}
  );
  const [editedContent, setEditedContent] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const content = editedContent ?? (state?.reply || "");

  const handleCopy = async () => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <div className="space-y-3">
      <form action={formAction} className="flex items-center justify-between">
        <input type="hidden" name="leadId" value={leadId} />
        <button
          type="submit"
          disabled={pending}
          className="btn btn-secondary btn-sm gap-1.5"
        >
          {pending ? (
            <Loader2 className="size-3.5 animate-spin text-[var(--brand)]" />
          ) : (
            <Sparkles className="size-3.5 text-[var(--brand)]" />
          )}
          {content ? "Regenerate AI Draft" : "Draft Enquiry Reply with AI"}
        </button>
        {content ? (
          <button
            type="button"
            onClick={handleCopy}
            className="btn btn-secondary btn-sm gap-1.5"
          >
            {copied ? <Check className="size-3.5 text-[var(--success)]" /> : <Copy className="size-3.5" />}
            {copied ? "Copied!" : "Copy reply"}
          </button>
        ) : null}
      </form>

      {content ? (
        <div className="space-y-1.5">
          <p className="text-[11px] text-muted">
            You can edit this draft directly before copying or sending via email/SMS.
          </p>
          <textarea
            value={content}
            onChange={(e) => setEditedContent(e.target.value)}
            rows={10}
            className="textarea w-full font-sans text-xs leading-relaxed"
          />
        </div>
      ) : null}
    </div>
  );
}
