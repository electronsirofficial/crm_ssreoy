import Link from "next/link";
import { reviewFlagAction } from "@/app/actions/admin";
import { FLAG_LABELS } from "@/lib/flags";
import { Badge, SEVERITY_TONE, fmtDate, humanize } from "./ui";

type Flag = {
  id: string;
  type: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  status: string;
  message: string;
  createdAt: Date;
  callId: string | null;
  visitId: string | null;
  leadId: string | null;
  reviewNote: string | null;
  agent?: { name: string } | null;
  lead?: { studentName: string } | null;
  reviewedBy?: { name: string } | null;
};

export function FlagItem({ f, showLead }: { f: Flag; showLead?: boolean }) {
  return (
    <div className="flex flex-wrap items-start gap-3 border-b border-slate-100 py-3 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={SEVERITY_TONE[f.severity]}>{f.severity}</Badge>
          <span className="text-sm font-medium">{FLAG_LABELS[f.type] ?? humanize(f.type)}</span>
          {f.status !== "OPEN" && <Badge tone={f.status === "CONFIRMED" ? "red" : "slate"}>{humanize(f.status)}</Badge>}
          <span className="text-xs text-slate-500">{fmtDate(f.createdAt)}</span>
        </div>
        <div className="mt-1 text-sm text-slate-700">{f.message}</div>
        <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-500">
          {f.agent && <span>Agent: {f.agent.name}</span>}
          {showLead && f.leadId && (
            <Link href={`/admin/leads/${f.leadId}`} className="link">
              {f.lead?.studentName ?? "Lead"}
            </Link>
          )}
          {f.callId && (
            <Link href={`/admin/calls/${f.callId}`} className="link">
              Call
            </Link>
          )}
          {f.visitId && (
            <Link href={`/admin/visits/${f.visitId}`} className="link">
              Visit
            </Link>
          )}
          {f.reviewedBy && (
            <span>
              Reviewed by {f.reviewedBy.name}
              {f.reviewNote ? ` — ${f.reviewNote}` : ""}
            </span>
          )}
        </div>
      </div>
      {f.status === "OPEN" ? (
        <form action={reviewFlagAction} className="flex flex-wrap gap-1.5">
          <input type="hidden" name="flagId" value={f.id} />
          <input name="note" placeholder="Note" className="input w-36 py-1.5" />
          <button name="status" value="CONFIRMED" className="btn-danger px-2.5 py-1.5">
            Confirm
          </button>
          <button name="status" value="DISMISSED" className="btn-secondary px-2.5 py-1.5">
            Dismiss
          </button>
        </form>
      ) : (
        <form action={reviewFlagAction}>
          <input type="hidden" name="flagId" value={f.id} />
          <button name="status" value="OPEN" className="text-xs text-slate-500 hover:underline">
            Reopen
          </button>
        </form>
      )}
    </div>
  );
}
