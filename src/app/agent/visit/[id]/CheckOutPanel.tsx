"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useGeo } from "../useGeo";

export function CheckOutPanel({ visitId, checkInAt }: { visitId: string; checkInAt: string }) {
  const router = useRouter();
  const { fix, error: geoError } = useGeo();
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.max(0, Math.floor((now - new Date(checkInAt).getTime()) / 1000));

  async function checkout() {
    if (!fix) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/visits/${visitId}/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, clientAt: Date.now() }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      return setError(json.error ?? "Check-out failed");
    }
    router.replace(`/agent/visit/${visitId}/questionnaire`);
  }

  return (
    <div className="space-y-3">
      <div className="text-center text-4xl font-semibold tabular-nums">
        {String(Math.floor(secs / 3600)).padStart(2, "0")}:{String(Math.floor((secs % 3600) / 60)).padStart(2, "0")}:{String(secs % 60).padStart(2, "0")}
      </div>
      <div className="text-center text-xs text-slate-500">{fix ? `GPS ready (±${Math.round(fix.accuracy)} m)` : geoError ?? "Getting location…"}</div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button className="btn-danger w-full py-3" disabled={!fix || busy} onClick={checkout}>
        {busy ? "Checking out…" : "Check out — leaving now"}
      </button>
    </div>
  );
}
