import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { upsertCriterionAction, upsertQuestionAction, upsertStageAction } from "@/app/actions/admin";
import { Badge, Card, PageHeader } from "@/components/ui";
import { RulesForm } from "./RulesForm";

export default async function Settings() {
  await requireUser(["ADMIN"]);
  const [settings, criteria, questions, stages] = await Promise.all([
    getSettings(),
    prisma.evaluationCriterion.findMany({ orderBy: { order: "asc" } }),
    prisma.questionnaireQuestion.findMany({ orderBy: { order: "asc" } }),
    prisma.leadStage.findMany({ orderBy: { order: "asc" } }),
  ]);
  const totalWeight = criteria.filter((c) => c.active).reduce((a, c) => a + c.weight, 0);

  return (
    <>
      <PageHeader title="Settings" subtitle="Commission policy, evidence thresholds, AI evaluation criteria, questionnaire and pipeline." />
      <div className="space-y-4">
        <Card title="Commission & evidence rules">
          <RulesForm settings={settings} />
        </Card>

        <Card title={`AI call evaluation criteria (total weight ${totalWeight})`}>
          <p className="mb-3 text-xs text-slate-500">
            Claude scores every call 0–10 on each active criterion. The call quality score is the weighted average. Changes apply to calls analysed from now on.
          </p>
          <div className="space-y-2">
            {[...criteria, null].map((c) => (
              <form key={c?.id ?? "new"} action={upsertCriterionAction} className="grid gap-2 rounded-lg border border-slate-200 p-2 md:grid-cols-[1fr_2fr_70px_60px_auto_auto]">
                <input type="hidden" name="id" value={c?.id ?? ""} />
                <input name="label" defaultValue={c?.label} placeholder="New criterion" className="input" required />
                <input name="description" defaultValue={c?.description} placeholder="What the AI should look for" className="input" required />
                <input name="weight" type="number" min={0} defaultValue={c?.weight ?? 10} className="input" title="Weight" />
                <input name="order" type="number" defaultValue={c?.order ?? criteria.length} className="input" title="Order" />
                <label className="flex items-center gap-1 text-xs">
                  <input type="checkbox" name="active" defaultChecked={c?.active ?? true} /> Active
                </label>
                <button className="btn-secondary">{c ? "Save" : "Add"}</button>
              </form>
            ))}
          </div>
        </Card>

        <Card title={`Post-visit questionnaire (${questions.filter((q) => q.active).length} active)`}>
          <p className="mb-3 text-xs text-slate-500">Options: one per line. Questions with a semantic tag (e.g. INTEREST) feed attribution and AI checks — keep them.</p>
          <div className="space-y-2">
            {[...questions, null].map((q) => (
              <form key={q?.id ?? "new"} action={upsertQuestionAction} className="grid gap-2 rounded-lg border border-slate-200 p-2 md:grid-cols-[2fr_120px_2fr_60px_auto]">
                <input type="hidden" name="id" value={q?.id ?? ""} />
                <div>
                  <input name="text" defaultValue={q?.text} placeholder="New question" className="input" required />
                  {q?.semantic && (
                    <div className="mt-1">
                      <Badge tone="blue">{q.semantic}</Badge>
                    </div>
                  )}
                </div>
                <select name="type" defaultValue={q?.type ?? "SINGLE"} className="input">
                  <option value="SINGLE">Single choice</option>
                  <option value="MULTI">Multiple choice</option>
                  <option value="DROPDOWN">Dropdown</option>
                  <option value="BOOLEAN">Yes / No</option>
                  <option value="DATE">Date</option>
                  <option value="NUMBER">Number</option>
                  <option value="TEXT">Text</option>
                </select>
                <textarea name="options" rows={2} defaultValue={((q?.options as string[] | null) ?? []).join("\n")} placeholder="Options (one per line)" className="input" />
                <input name="order" type="number" defaultValue={q?.order ?? questions.length} className="input" title="Order" />
                <div className="flex flex-col gap-1 text-xs">
                  <label className="flex items-center gap-1">
                    <input type="checkbox" name="required" defaultChecked={q?.required ?? true} /> Required
                  </label>
                  <label className="flex items-center gap-1">
                    <input type="checkbox" name="active" defaultChecked={q?.active ?? true} /> Active
                  </label>
                  <button className="btn-secondary py-1">{q ? "Save" : "Add"}</button>
                </div>
              </form>
            ))}
          </div>
        </Card>

        <Card title="Lead stages">
          <div className="space-y-2">
            {[...stages, null].map((s) => (
              <form key={s?.key ?? "new"} action={upsertStageAction} className="grid gap-2 md:grid-cols-[200px_1fr_70px_120px_auto_auto]">
                <input name="key" defaultValue={s?.key} readOnly={!!s} placeholder="KEY" className="input font-mono text-xs" required />
                <input name="label" defaultValue={s?.label} placeholder="Label" className="input" required />
                <input name="order" type="number" defaultValue={s?.order ?? stages.length} className="input" />
                <select name="color" defaultValue={s?.color ?? "slate"} className="input">
                  {["slate", "sky", "indigo", "violet", "amber", "orange", "yellow", "teal", "green", "red"].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
                <label className="flex items-center gap-1 text-xs">
                  <input type="checkbox" name="active" defaultChecked={s?.active ?? true} disabled={["ENROLLED", "OFFICE_VISIT_DONE", "NEW"].includes(s?.key ?? "")} /> Active
                </label>
                <button className="btn-secondary">{s ? "Save" : "Add"}</button>
              </form>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">NEW, OFFICE_VISIT_DONE and ENROLLED are used by the system and cannot be disabled.</p>
        </Card>
      </div>
    </>
  );
}
