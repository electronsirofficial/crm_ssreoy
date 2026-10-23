"use client";

import { useActionState } from "react";
import { decideCommissionAction } from "@/app/actions/admin";

export function CommissionDecisionForm({
  commissionId,
  status,
  suggestedAgentId,
  amount,
  agents,
  compact,
}: {
  commissionId: string;
  status: string;
  suggestedAgentId: string;
  amount: number;
  agents: { id: string; name: string }[];
  compact?: boolean;
}) {
  const [state, action, pending] = useActionState(decideCommissionAction, null);
  if (status === "APPROVED") {
    return (
      <form action={action} className="flex items-center gap-2">
        <input type="hidden" name="commissionId" value={commissionId} />
        <button name="decision" value="PAID" className="btn-secondary py-1.5" disabled={pending}>
          Mark paid
        </button>
        {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
      </form>
    );
  }
  return (
    <form action={action} className={`grid gap-2 ${compact ? "" : "sm:grid-cols-[1fr_120px_2fr]"}`}>
      <input type="hidden" name="commissionId" value={commissionId} />
      <select name="agentId" defaultValue={suggestedAgentId} className="input">
        <option value="">— Agent —</option>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <input name="amount" type="number" min={0} defaultValue={amount} className="input" aria-label="Amount" />
      <input name="note" placeholder={status === "PENDING_REVIEW" ? "Note (required to reject)" : "Reason for your decision (required)"} className="input" />
      <div className={`flex flex-wrap items-center gap-2 ${compact ? "" : "sm:col-span-3"}`}>
        <button name="decision" value="APPROVED" className="btn-success py-1.5" disabled={pending}>
          Approve commission
        </button>
        <button name="decision" value="REJECTED" className="btn-secondary py-1.5" disabled={pending}>
          Reject
        </button>
        {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
        {state?.ok && <span className="text-xs text-emerald-700">{state.ok}</span>}
      </div>
    </form>
  );
}
