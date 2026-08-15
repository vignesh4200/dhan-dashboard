"use client";
import { useEffect, useState } from "react";

export default function SettingsPage() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [clientId, setClientId] = useState("");
  const [pin, setPin] = useState("");
  const [totpSecret, setTotpSecret] = useState("");
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
        body: JSON.stringify({ dhanClientId: clientId, dhanPin: pin, totpSecret, whatsappNumber }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setStatus("Saved and verified — your token will now stay fresh automatically, no more manual updates.");
      setConfigured(true);
      setPin("");
      setTotpSecret("");
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
          {configured ? "Dhan TOTP authentication connected" : "No Dhan credentials saved yet"}
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

        <label className="field-label">Dhan PIN</label>
        <input
          className="field-input"
          type="password"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="Your Dhan trading PIN"
        />

        <label className="field-label">TOTP Secret</label>
        <input
          className="field-input"
          type="password"
          value={totpSecret}
          onChange={(e) => setTotpSecret(e.target.value)}
          placeholder="Paste the secret key shown when setting up TOTP"
        />
        <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: -8, marginBottom: 14 }}>
          From Dhan Web → Profile → DhanHQ Trading APIs → Set up TOTP. When it shows you a QR code,
          look for a "can't scan? enter this key manually" option — that text string is what goes here.
          Once saved, your dashboard mints a fresh access token automatically every 15 minutes — you
          never need to touch this again unless you change your Dhan PIN or reset TOTP.
        </div>

        <label className="field-label">WhatsApp number for alerts</label>
        <input
          className="field-input"
          value={whatsappNumber}
          onChange={(e) => setWhatsappNumber(e.target.value)}
          placeholder="+919876543210"
        />

        <button className="btn" disabled={busy || !clientId || !pin || !totpSecret} onClick={save}>
          {busy ? "Verifying…" : "Save & verify credentials"}
        </button>

        {status && <div style={{ marginTop: 12, fontSize: 12.5, color: "var(--text-muted)" }}>{status}</div>}
      </div>
    </div>
  );
}
