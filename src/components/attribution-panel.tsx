import Link from "next/link";
import type { AttributionResult, Touchpoint } from "@/lib/attribution";
import { Badge, COMMISSION_TONE, KV, fmtDate, humanize, inr } from "./ui";
import { CommissionDecisionForm } from "./CommissionDecisionForm";

type Stored = {
  id: string;
  status: string;
  attribution: string;
  amount: number;
  confidence: number;
  agent: { id: string; name: string } | null;
  reasoning: unknown;
  evidence: unknown;
  contenders: unknown;
  decidedBy: { name: string } | null;
  decidedAt: Date | null;
  decisionNote: string | null;
};

export function AttributionView({ stored, preview, agents }: { stored: Stored | null; preview: AttributionResult | null; agents: { id: string; name: string }[] }) {
  const reasoning = (stored ? (stored.reasoning as string[]) : preview?.reasoning) ?? [];
  const evidence = (stored ? (stored.evidence as Touchpoint[]) : preview?.touchpoints) ?? [];
  const contenders = ((stored ? stored.contenders : preview?.contenders) as AttributionResult["contenders"] | null) ?? [];
  const status = stored?.status ?? preview?.status ?? "";
  const attribution = stored?.attribution ?? preview?.attribution ?? "";
  const agentName = stored ? stored.agent?.name : contenders.find((c) => c.agentId === preview?.agentId)?.name;

  return (
    <div className="space-y-4">
      {!stored && (
        <p className="rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600">
          Not enrolled yet. This is a live preview of how the admission would be attributed if the family enrolled now.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={COMMISSION_TONE[status]}>{humanize(status)}</Badge>
        <Badge tone={attribution === "WALK_IN" ? "orange" : attribution === "CONTESTED" ? "red" : "blue"}>{humanize(attribution)}</Badge>
        {agentName && <span className="text-sm font-medium">{agentName}</span>}
        {stored && <span className="text-sm text-slate-600">{inr(stored.amount)}</span>}
        <span className="text-xs text-slate-500">confidence {stored?.confidence ?? preview?.confidence}%</span>
      </div>
      <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
        {reasoning.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>

      {contenders.length > 1 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
          <div className="mb-1 font-medium text-red-800">Competing claims</div>
          <ul className="space-y-0.5">
            {contenders.map((c) => (
              <li key={c.agentId}>
                {c.name}: strength {c.strength}, first evidence {fmtDate(c.firstEvidenceAt)}, last {fmtDate(c.lastEvidenceAt)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="-mx-4 overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Evidence</th>
              <th>Agent</th>
              <th>When</th>
              <th>Counts?</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            {evidence.map((t) => (
              <tr key={t.id}>
                <td>
                  <Link href={t.kind === "CALL" ? `/admin/calls/${t.id}` : `/admin/visits/${t.id}`} className="link">
                    {t.kind === "CALL" ? "📞 Call" : "📍 Visit"}
                  </Link>
                </td>
                <td className="text-sm">{t.agentName}</td>
                <td className="text-xs whitespace-nowrap">
                  {fmtDate(t.at)}
                  {t.recordedAt !== t.at && <div className="text-slate-400">uploaded {fmtDate(t.recordedAt)}</div>}
                </td>
                <td>{t.qualifies ? <Badge tone="green">Qualifies</Badge> : t.contested ? <Badge tone="amber">Contested</Badge> : <Badge tone="slate">No</Badge>}</td>
                <td className="text-xs text-slate-600">{t.reasons.join("; ")}</td>
              </tr>
            ))}
            {!evidence.length && (
              <tr>
                <td colSpan={5} className="text-sm text-slate-500">
                  No calls or visits recorded by any agent.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {stored && (
        <div className="border-t border-slate-100 pt-4">
          {stored.decidedBy ? (
            <KV
              items={[
                ["Decision", `${humanize(stored.status)} by ${stored.decidedBy.name}`],
                ["When", fmtDate(stored.decidedAt)],
                ["Note", stored.decisionNote],
              ]}
            />
          ) : null}
          {stored.status !== "PAID" && stored.status !== "REJECTED" && (
            <div className="mt-3">
              <CommissionDecisionForm
                commissionId={stored.id}
                status={stored.status}
                suggestedAgentId={stored.agent?.id ?? ""}
                amount={stored.amount}
                agents={agents}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
