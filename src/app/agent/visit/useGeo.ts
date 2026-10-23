"use client";

import { useEffect, useState } from "react";

export type Fix = { lat: number; lng: number; accuracy: number; at: number };

/** Watches high-accuracy GPS and keeps the best recent fix. */
export function useGeo() {
  const [fix, setFix] = useState<Fix | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setError("This device does not support GPS location.");
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const next = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: Date.now() };
        setFix((prev) => (!prev || next.accuracy <= prev.accuracy || next.at - prev.at > 20000 ? next : prev));
        setError(null);
      },
      (e) => setError(e.code === 1 ? "Location permission denied. Allow location access for this site in your browser settings." : "Waiting for GPS signal…"),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  return { fix, error };
}
