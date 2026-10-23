"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

function nowLocal() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function CallUploadForm({ leadId, sttEnabled }: { leadId: string; sttEnabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [showTranscript, setShowTranscript] = useState(!sttEnabled);

  // Read the real duration from the audio file so it isn't self-reported.
  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    setDuration(null);
    if (!f) return;
    const url = URL.createObjectURL(f);
    const audio = new Audio();
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      if (Number.isFinite(audio.duration)) setDuration(Math.round(audio.duration));
      URL.revokeObjectURL(url);
    };
    audio.src = url;
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("leadId", leadId);
    fd.set("calledAt", new Date(String(fd.get("calledAtLocal"))).toISOString());
    if (duration) fd.set("durationSec", String(duration));
    const res = await fetch("/api/calls", { method: "POST", body: fd });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(json.error ?? "Upload failed");
    router.push(`/agent/leads/${leadId}`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="card space-y-4 p-4">
      <label className="block">
        <span className="label">Call recording</span>
        <input type="file" name="recording" accept="audio/*,video/mp4" onChange={onFile} className="input" />
        <span className="mt-1 block text-xs text-slate-500">
          Export the recording from your phone&apos;s call recorder (mp3, m4a, wav, amr, ogg). Recordings are required for commission.
          {duration != null && <b className="ml-1 text-slate-700">Detected length: {Math.floor(duration / 60)}m {duration % 60}s</b>}
        </span>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label">When was the call?</span>
          <input type="datetime-local" name="calledAtLocal" defaultValue={nowLocal()} max={nowLocal()} required className="input" />
        </label>
        {duration == null && (
          <label className="block">
            <span className="label">Duration (seconds)</span>
            <input type="number" name="durationSec" min={0} className="input" />
          </label>
        )}
        <label className="block">
          <span className="label">Outcome</span>
          <select name="reportedOutcome" className="input" required defaultValue="">
            <option value="" disabled>
              Select…
            </option>
            <option>Invited to institute – agreed to visit</option>
            <option>Invited to institute – will think</option>
            <option>Explained courses, call back later</option>
            <option>Home visit scheduled</option>
            <option>Not interested</option>
            <option>Wrong number / not reachable</option>
          </select>
        </label>
        <label className="block">
          <span className="label">Interest level</span>
          <select name="reportedInterest" className="input" defaultValue="Medium">
            <option>High</option>
            <option>Medium</option>
            <option>Low</option>
            <option>None</option>
          </select>
        </label>
      </div>
      <label className="block">
        <span className="label">Notes</span>
        <textarea name="reportedNotes" rows={2} className="input" placeholder="Anything important the family said" />
      </label>
      {showTranscript ? (
        <label className="block">
          <span className="label">Transcript {sttEnabled ? "(optional)" : "(automatic transcription is off — paste one if available)"}</span>
          <textarea name="transcript" rows={5} className="input" />
        </label>
      ) : (
        <button type="button" onClick={() => setShowTranscript(true)} className="text-xs text-brand-600 hover:underline">
          Paste a transcript instead
        </button>
      )}
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="consent" className="mt-1" required />
        <span>I informed the person that the call was being recorded.</span>
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button className="btn-primary w-full py-3" disabled={busy}>
        {busy ? "Uploading…" : "Save call"}
      </button>
    </form>
  );
}
