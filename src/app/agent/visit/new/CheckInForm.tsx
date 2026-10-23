"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useGeo } from "../useGeo";

/**
 * Photos come straight from the live camera stream (no gallery picker), so an old photo cannot be
 * uploaded. GPS comes from the browser; the server stamps time, location and agent onto the image.
 */
export function CheckInForm({ leadId }: { leadId: string }) {
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { fix, error: geoError } = useGeo();

  useEffect(() => {
    let s: MediaStream | null = null;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } }, audio: false })
      .then((st) => {
        s = st;
        setStream(st);
        if (video.current) video.current.srcObject = st;
      })
      .catch(() => setCamError("Camera access is required. Allow camera permission for this site (HTTPS is required on phones)."));
    return () => s?.getTracks().forEach((t) => t.stop());
  }, []);

  function capture() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    c.toBlob(
      (b) => {
        if (!b) return;
        setPhoto(b);
        setPreview(URL.createObjectURL(b));
      },
      "image/jpeg",
      0.9,
    );
  }

  async function submit() {
    if (!photo || !fix) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("leadId", leadId);
    fd.set("photo", photo, "checkin.jpg");
    fd.set("lat", String(fix.lat));
    fd.set("lng", String(fix.lng));
    fd.set("accuracy", String(fix.accuracy));
    fd.set("clientAt", String(Date.now()));
    const res = await fetch("/api/visits/checkin", { method: "POST", body: fd });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      return setError(json.error ?? "Check-in failed");
    }
    stream?.getTracks().forEach((t) => t.stop());
    router.replace(`/agent/visit/${json.id}`);
  }

  return (
    <div className="card space-y-4 p-4">
      <div className="overflow-hidden rounded-lg bg-black">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Captured" className="aspect-[4/3] w-full object-contain" />
        ) : (
          <video ref={video} autoPlay playsInline muted className="aspect-[4/3] w-full object-cover" />
        )}
      </div>
      {camError && <p className="text-sm text-red-600">{camError}</p>}
      {preview ? (
        <button
          className="btn-secondary w-full"
          onClick={() => {
            setPhoto(null);
            setPreview(null);
            setTimeout(() => video.current && stream && (video.current.srcObject = stream), 0);
          }}
        >
          Retake photo
        </button>
      ) : (
        <button className="btn-secondary w-full py-3" onClick={capture} disabled={!stream}>
          📷 Take photo of the house / meeting
        </button>
      )}

      <div className="rounded-lg bg-slate-50 p-3 text-sm">
        {fix ? (
          <>
            <div>
              📍 {fix.lat.toFixed(6)}, {fix.lng.toFixed(6)}
            </div>
            <div className={fix.accuracy > 100 ? "text-amber-700" : "text-slate-500"}>
              Accuracy ±{Math.round(fix.accuracy)} m {fix.accuracy > 100 && "— move outdoors / near a window for a better fix"}
            </div>
          </>
        ) : (
          <div className="text-slate-500">{geoError ?? "Getting your location…"}</div>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <button className="btn-primary w-full bg-violet-600 py-3 hover:bg-violet-700" disabled={!photo || !fix || busy} onClick={submit}>
        {busy ? "Checking in…" : "Check in"}
      </button>
      <p className="text-xs text-slate-500">Time is recorded by the server. Stay at the location for the meeting and check out when you leave.</p>
    </div>
  );
}
