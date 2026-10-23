"use client";

import { useActionState } from "react";
import { walkInAction, enrollAction } from "@/app/actions/desk";

export function WalkInForm({ agents, defaults, existing }: { agents: { id: string; name: string }[]; defaults: { phone?: string; studentName?: string; parentName?: string }; existing?: boolean }) {
  const [state, action, pending] = useActionState(walkInAction, null);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <label className="block">
        <span className="label">Student name *</span>
        <input name="studentName" defaultValue={defaults.studentName} required className="input" />
      </label>
      <label className="block">
        <span className="label">Parent name</span>
        <input name="parentName" defaultValue={defaults.parentName} className="input" />
      </label>
      <label className="block">
        <span className="label">Mobile *</span>
        <input name="phone" defaultValue={defaults.phone} required inputMode="numeric" className="input" readOnly={existing} />
      </label>
      {!existing && (
        <>
          <label className="block">
            <span className="label">Class</span>
            <select name="classLevel" className="input" defaultValue="">
              <option value="">—</option>
              {["Class 8", "Class 9", "Class 10", "Class 11", "Class 12", "12th pass (dropper)"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">Target exam</span>
            <select name="targetExam" className="input" defaultValue="UNKNOWN">
              <option value="UNKNOWN">Not sure</option>
              <option value="JEE">IIT-JEE</option>
              <option value="NEET">NEET</option>
              <option value="FOUNDATION">Foundation</option>
              <option value="OTHER">Other</option>
            </select>
          </label>
          <label className="block">
            <span className="label">Locality</span>
            <input name="locality" className="input" />
          </label>
        </>
      )}
      <label className="block sm:col-span-2">
        <span className="label">Did the family mention an agent? (ask, don&apos;t suggest)</span>
        <select name="declaredAgentId" className="input" defaultValue="">
          <option value="">No / came on their own</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block sm:col-span-2">
        <span className="label">How did they hear about us?</span>
        <input name="walkInNotes" className="input" placeholder="e.g. newspaper ad, friend studying here, agent called" />
      </label>
      {state?.error && <p className="text-sm text-red-600 sm:col-span-2">{state.error}</p>}
      <button className="btn-primary sm:col-span-2" disabled={pending}>
        {pending ? "Saving…" : existing ? "Record institute visit" : "Register walk-in"}
      </button>
    </form>
  );
}

export function EnrollForm({ leadId }: { leadId: string }) {
  const [state, action, pending] = useActionState(enrollAction, null);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
      <input type="hidden" name="leadId" value={leadId} />
      <label className="block">
        <span className="label">Course</span>
        <input name="course" required list="courses" className="input" />
        <datalist id="courses">
          <option>JEE 2-Year Classroom</option>
          <option>JEE 1-Year Crash</option>
          <option>NEET 2-Year Classroom</option>
          <option>NEET 1-Year Crash</option>
          <option>Foundation (Class 8–10)</option>
          <option>Dropper Batch</option>
        </datalist>
      </label>
      <label className="block">
        <span className="label">Fee (₹)</span>
        <input name="feeAmount" type="number" min={0} className="input" />
      </label>
      <button className="btn-success" disabled={pending}>
        {pending ? "Saving…" : "Record enrollment"}
      </button>
      {state?.error && <p className="text-sm text-red-600 sm:col-span-3">{state.error}</p>}
    </form>
  );
}
