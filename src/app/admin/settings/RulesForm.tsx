"use client";

import { useActionState } from "react";
import { saveSettingsAction } from "@/app/actions/admin";
import type { CrmSettings } from "@/lib/settings";

function N({ name, label, value, hint }: { name: string; label: string; value: number; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input name={name} type="number" defaultValue={value} className="input" />
      {hint && <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function RulesForm({ settings: s }: { settings: CrmSettings }) {
  const [state, action, pending] = useActionState(saveSettingsAction, null);
  return (
    <form action={action} className="space-y-5">
      <section>
        <h3 className="mb-2 text-sm font-semibold">Commission</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <N name="commission.amountPerEnrollment" label="Amount per admission (₹)" value={s.commission.amountPerEnrollment} />
          <N name="commission.attributionWindowDays" label="Attribution window (days)" value={s.commission.attributionWindowDays} hint="Evidence older than this before enrollment doesn't count" />
          <label className="block">
            <span className="label">When several agents qualify</span>
            <select name="commission.model" defaultValue={s.commission.model} className="input">
              <option value="FIRST_QUALIFYING">Suggest first agent with evidence</option>
              <option value="LAST_QUALIFYING">Suggest last agent with evidence</option>
            </select>
            <span className="mt-0.5 block text-xs text-slate-500">Always sent to you as a dispute</span>
          </label>
          <label className="flex items-center gap-2 pt-5 text-sm">
            <input type="checkbox" name="commission.requireAdminApproval" defaultChecked={s.commission.requireAdminApproval} />
            Require admin approval
          </label>
        </div>
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold">Calls</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <N name="call.minDurationSec" label="Min call length (sec)" value={s.call.minDurationSec} />
          <N name="call.minQualityScore" label="Min AI quality score" value={s.call.minQualityScore} />
          <N name="call.lateUploadGraceHours" label="Flag uploads later than (hours)" value={s.call.lateUploadGraceHours} />
          <label className="flex items-center gap-2 pt-5 text-sm">
            <input type="checkbox" name="call.requireRecording" defaultChecked={s.call.requireRecording} />
            Recording required for commission
          </label>
        </div>
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold">Field visits</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <N name="visit.minDurationMin" label="Min visit (minutes)" value={s.visit.minDurationMin} />
          <N name="visit.maxDurationMin" label="Max visit (minutes)" value={s.visit.maxDurationMin} />
          <N name="visit.maxGpsAccuracyM" label="Max GPS error (m)" value={s.visit.maxGpsAccuracyM} />
          <N name="visit.maxDistanceFromHomeM" label="Max distance from home (m)" value={s.visit.maxDistanceFromHomeM} />
          <N name="visit.maxCheckInOutDriftM" label="Max check-in/out drift (m)" value={s.visit.maxCheckInOutDriftM} />
          <N name="visit.minVerificationScore" label="Min verification score" value={s.visit.minVerificationScore} />
          <N name="visit.questionnaireDeadlineHours" label="Questionnaire deadline (h)" value={s.visit.questionnaireDeadlineHours} />
          <N name="visit.minQuestionnaireSeconds" label="Min questionnaire time (s)" value={s.visit.minQuestionnaireSeconds} />
          <N name="visit.maxTravelSpeedKmh" label="Max travel speed (km/h)" value={s.visit.maxTravelSpeedKmh} />
          <N name="visit.maxClientSkewMin" label="Max device clock skew (min)" value={s.visit.maxClientSkewMin} />
          <N name="visit.sameSpotRadiusM" label="Same-spot radius (m)" value={s.visit.sameSpotRadiusM} />
        </div>
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold">AI alerts</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <N name="ai.hotLeadThreshold" label="Hot lead threshold (%)" value={s.ai.hotLeadThreshold} />
          <N name="ai.neglectHours" label="Flag hot lead untouched after (h)" value={s.ai.neglectHours} />
        </div>
      </section>
      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={pending}>
          Save rules
        </button>
        {state?.ok && <span className="text-sm text-emerald-700">{state.ok}</span>}
      </div>
    </form>
  );
}
