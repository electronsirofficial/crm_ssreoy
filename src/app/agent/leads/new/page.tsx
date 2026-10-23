"use client";

import Link from "next/link";
import { useActionState } from "react";
import { createLeadAction } from "@/app/actions/agent";
import { PageHeader } from "@/components/ui";

export default function NewLead() {
  const [state, action, pending] = useActionState(createLeadAction, null);
  return (
    <>
      <PageHeader title="New lead" subtitle="Phone numbers are checked against every family already in the CRM." />
      <form action={action} className="card grid gap-3 p-4 sm:grid-cols-2">
        <F label="Student name *" name="studentName" required />
        <F label="Parent name" name="parentName" />
        <F label="Mobile number *" name="phone" type="tel" inputMode="numeric" required placeholder="10-digit mobile" />
        <F label="Alternate number" name="altPhone" type="tel" inputMode="numeric" />
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
            <option value="UNKNOWN">Not known yet</option>
            <option value="JEE">IIT-JEE</option>
            <option value="NEET">NEET</option>
            <option value="FOUNDATION">Foundation / Olympiad</option>
            <option value="OTHER">Other</option>
          </select>
        </label>
        <F label="School" name="school" />
        <F label="Locality" name="locality" />
        <F label="Address" name="address" className="sm:col-span-2" />
        <label className="block">
          <span className="label">How did you reach them?</span>
          <select name="source" className="input" defaultValue="OUTBOUND_CALL">
            <option value="OUTBOUND_CALL">Outbound call</option>
            <option value="FIELD_VISIT">Field visit</option>
            <option value="REFERRAL">Referral</option>
            <option value="OTHER">Other</option>
          </select>
        </label>
        <F label="Notes" name="notes" />
        {state?.error && (
          <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 sm:col-span-2">
            {state.error}{" "}
            {state.existingId && (
              <Link href={`/agent/leads/${state.existingId}`} className="link">
                Open lead
              </Link>
            )}
          </div>
        )}
        <div className="sm:col-span-2">
          <button className="btn-primary" disabled={pending}>
            {pending ? "Saving…" : "Create lead"}
          </button>
        </div>
      </form>
    </>
  );
}

function F({ label, className = "", ...props }: { label: string; className?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      <input {...props} className="input" />
    </label>
  );
}
