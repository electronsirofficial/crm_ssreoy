"use client";

import { useActionState, useState } from "react";
import { submitQuestionnaireAction } from "@/app/actions/agent";

type Q = { key: string; text: string; type: string; options: string[]; required: boolean };

export function QuestionnaireForm({ visitId, questions }: { visitId: string; questions: Q[] }) {
  const [state, action, pending] = useActionState(submitQuestionnaireAction, null);
  const [startedAt] = useState(() => Date.now());
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="visitId" value={visitId} />
      <input type="hidden" name="startedAt" value={startedAt} />
      {questions.map((q, i) => (
        <fieldset key={q.key} className="card p-4">
          <legend className="sr-only">{q.text}</legend>
          <div className="mb-2 text-sm font-medium">
            {i + 1}. {q.text} {q.required && <span className="text-red-500">*</span>}
          </div>
          <Input q={q} />
        </fieldset>
      ))}
      {state?.error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{state.error}</p>}
      <button className="btn-primary sticky bottom-3 w-full py-3 shadow-lg" disabled={pending}>
        {pending ? "Submitting…" : "Submit questionnaire"}
      </button>
    </form>
  );
}

function Input({ q }: { q: Q }) {
  const chip = "flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50";
  switch (q.type) {
    case "SINGLE":
      return (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {q.options.map((o) => (
            <label key={o} className={chip}>
              <input type="radio" name={q.key} value={o} required={q.required} /> {o}
            </label>
          ))}
        </div>
      );
    case "MULTI":
      return (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {q.options.map((o) => (
            <label key={o} className={chip}>
              <input type="checkbox" name={q.key} value={o} /> {o}
            </label>
          ))}
        </div>
      );
    case "DROPDOWN":
      return (
        <select name={q.key} required={q.required} defaultValue="" className="input">
          <option value="" disabled>
            Select…
          </option>
          {q.options.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      );
    case "BOOLEAN":
      return (
        <div className="flex gap-2">
          {["yes", "no"].map((v) => (
            <label key={v} className={`${chip} flex-1 justify-center`}>
              <input type="radio" name={q.key} value={v} required={q.required} /> {v === "yes" ? "Yes" : "No"}
            </label>
          ))}
        </div>
      );
    case "DATE":
      return <input type="date" name={q.key} required={q.required} className="input" min={new Date().toISOString().slice(0, 10)} />;
    case "NUMBER":
      return <input type="number" name={q.key} required={q.required} className="input" />;
    default:
      return <textarea name={q.key} required={q.required} rows={2} className="input" />;
  }
}
