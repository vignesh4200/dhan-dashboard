"use client";
import { useEffect, useState } from "react";

export default function SettingsPage() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [clientId, setClientId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/settings/credentials")
      .then((r) => r.json())
      .then((d) => setConfigured(!!d.configured));
  }, []);

  async function save() {
    setBusy(true);
    setStatus("");
    try {
      const res = await fetch("/api/settings/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dhanClientId: clientId, dhanAccessToken: accessToken, whatsappNumber }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setStatus("Saved. Your dashboard will refresh with the new token within 15 minutes.");
      setConfigured(true);
      setAccessToken("");
    } catch (e: any) {
      setStatus(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wrap" style={{ paddingTop: 40 }}>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: 24 }}>Settings</h1>

      {configured !== null && (
        <span className={`settings-status ${configured ? "ok" : "missing"}`}>
          {configured ? "Dhan credentials connected" : "No Dhan credentials saved yet"}
        </span>
      )}

      <div className="panel settings-form" style={{ marginTop: 8 }}>
        <label className="field-label">Dhan Client ID</label>
        <input
          className="field-input"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder="1000000009"
        />

        <label className="field-label">Dhan Access Token</label>
        <input
          className="field-input"
          type="password"
          value={accessToken}
          onChange={(e) => setAccessToken(e.target.value)}
          placeholder="Paste your current JWT access token"
        />
        <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: -8, marginBottom: 14 }}>
          Generate this from Dhan Web → Profile → DhanHQ Trading APIs. Tokens can expire —
          come back here to update it whenever Dhan asks you to regenerate one.
        </div>

        <label className="field-label">WhatsApp number for alerts</label>
        <input
          className="field-input"
          value={whatsappNumber}
          onChange={(e) => setWhatsappNumber(e.target.value)}
          placeholder="+919876543210"
        />

        <button className="btn" disabled={busy || !clientId || !accessToken} onClick={save}>
          {busy ? "Saving…" : "Save credentials"}
        </button>

        {status && <div style={{ marginTop: 12, fontSize: 12.5, color: "var(--text-muted)" }}>{status}</div>}
      </div>
    </div>
  );
}
