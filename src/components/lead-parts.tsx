import { prisma } from "@/lib/db";
import { scheduleFollowUpAction, updateStageAction, completeFollowUpAction } from "@/app/actions/agent";
import { Badge, Empty, fmtDate, humanize } from "./ui";

const ACTIVITY_TONE: Record<string, string> = {
  WALK_IN: "orange",
  OFFICE_VISIT: "orange",
  ENROLLED: "green",
  ATTRIBUTION: "blue",
  DUPLICATE_ATTEMPT: "red",
  VISIT_CHECK_IN: "violet",
  VISIT_CHECK_OUT: "violet",
  QUESTIONNAIRE: "violet",
  CALL_LOGGED: "sky",
  CALL_ANALYZED: "sky",
  COMMISSION_DECISION: "green",
};

export async function Timeline({ leadId }: { leadId: string }) {
  const rows = await prisma.activity.findMany({
    where: { leadId },
    include: { actor: { select: { name: true } } },
    orderBy: { seq: "desc" },
    take: 100,
  });
  if (!rows.length) return <Empty>No activity yet</Empty>;
  return (
    <ol className="relative space-y-3 border-l border-slate-200 pl-4">
      {rows.map((r) => (
        <li key={r.id} className="relative">
          <span className="absolute top-1.5 -left-[21px] h-2.5 w-2.5 rounded-full border-2 border-white bg-slate-400" />
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="tabular-nums">{fmtDate(r.createdAt)}</span>
            <Badge tone={ACTIVITY_TONE[r.type] ?? "slate"}>{humanize(r.type)}</Badge>
            {r.actor && <span>{r.actor.name}</span>}
          </div>
          <div className="mt-0.5 text-sm text-slate-800">{r.message}</div>
        </li>
      ))}
    </ol>
  );
}

export async function StageForm({ leadId, current, allowOffice }: { leadId: string; current: string; allowOffice?: boolean }) {
  const stages = await prisma.leadStage.findMany({ where: { active: true }, orderBy: { order: "asc" } });
  return (
    <form action={updateStageAction} className="flex flex-wrap gap-2">
      <input type="hidden" name="leadId" value={leadId} />
      <select name="stageKey" defaultValue={current} className="input w-auto flex-1">
        {stages
          .filter((s) => allowOffice || !["ENROLLED", "OFFICE_VISIT_DONE"].includes(s.key) || s.key === current)
          .map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
      </select>
      <input name="lostReason" placeholder="Reason (if lost)" className="input w-auto flex-1" />
      <button className="btn-secondary">Update stage</button>
    </form>
  );
}

export function FollowUpForm({ leadId }: { leadId: string }) {
  const tomorrow = new Date(Date.now() + 864e5 + 5.5 * 36e5).toISOString().slice(0, 11) + "10:00";
  return (
    <form action={scheduleFollowUpAction} className="grid gap-2 sm:grid-cols-[1fr_1fr_2fr_auto]">
      <input type="hidden" name="leadId" value={leadId} />
      <input type="datetime-local" name="dueAt" required defaultValue={tomorrow} className="input" />
      <select name="type" className="input">
        <option value="CALL">Call</option>
        <option value="HOME_VISIT">Home visit</option>
        <option value="INSTITUTE_VISIT">Institute visit</option>
        <option value="OTHER">Other</option>
      </select>
      <input name="notes" placeholder="What to discuss" className="input" />
      <button className="btn-primary">Schedule</button>
    </form>
  );
}

export function FollowUpRow({ f, showLead }: { f: { id: string; dueAt: Date; type: string; notes: string | null; status: string; lead?: { id: string; studentName: string } }; showLead?: string }) {
  const overdue = f.status === "PENDING" && f.dueAt < new Date();
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 py-2.5 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {showLead && f.lead && (
            <a href={`${showLead}/${f.lead.id}`} className="link">
              {f.lead.studentName}
            </a>
          )}
          <Badge tone={overdue ? "red" : "slate"}>{humanize(f.type)}</Badge>
          <span className={`tabular-nums ${overdue ? "font-medium text-red-600" : "text-slate-600"}`}>{fmtDate(f.dueAt)}</span>
          {overdue && <span className="text-xs text-red-600">overdue</span>}
        </div>
        {f.notes && <div className="mt-0.5 text-xs text-slate-500">{f.notes}</div>}
      </div>
      {f.status === "PENDING" ? (
        <form action={completeFollowUpAction} className="flex gap-1.5">
          <input type="hidden" name="id" value={f.id} />
          <input name="outcome" placeholder="Outcome" className="input w-36 py-1.5" />
          <button className="btn-success px-2.5 py-1.5" name="status" value="DONE">
            Done
          </button>
          <button className="btn-secondary px-2.5 py-1.5" name="status" value="CANCELLED">
            ✕
          </button>
        </form>
      ) : (
        <Badge tone={f.status === "DONE" ? "green" : "slate"}>{humanize(f.status)}</Badge>
      )}
    </div>
  );
}

export function stageTone(stages: { key: string; color: string }[], key: string) {
  return stages.find((s) => s.key === key)?.color ?? "slate";
}
