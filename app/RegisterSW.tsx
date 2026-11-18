"use client";

import { useEffect } from "react";

// Registers /sw.js so the dashboard can be installed as an app.
// Skipped in `next dev` to avoid caching surprises while developing.
export default function RegisterSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  }, []);
  return null;
}
