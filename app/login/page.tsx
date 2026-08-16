"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  ConfirmationResult,
} from "firebase/auth";
import { firebaseAuth } from "@/lib/firebaseClient";

// This is a personal single-user dashboard — only this exact number is
// allowed to log in. No OTP is even requested for any other number, so no
// SMS cost or attempt is wasted on wrong/random numbers. Change this if
// your own number ever changes.
const ALLOWED_PHONE_E164 = "+919900678481";

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function sendOtp() {
    setError("");
    const e164 = phone.startsWith("+") ? phone : `+91${phone.replace(/\D/g, "")}`;

    if (e164 !== ALLOWED_PHONE_E164) {
      setError("This number isn't authorized for this dashboard.");
      return;
    }

    setBusy(true);
    try {
      // Invisible reCAPTCHA container, required by Firebase phone auth.
      const verifier = new RecaptchaVerifier(firebaseAuth, "recaptcha-container", {
        size: "invisible",
      });
      const result = await signInWithPhoneNumber(firebaseAuth, e164, verifier);
      setConfirmation(result);
      setStep("otp");
    } catch (e: any) {
      setError(e.message || "Couldn't send the code. Check the number and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp() {
    setError("");
    setBusy(true);
    try {
      if (!confirmation) throw new Error("Session expired, request a new code.");
      const cred = await confirmation.confirm(code);
      const idToken = await cred.user.getIdToken();
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken, phone: cred.user.phoneNumber }),
      });
      if (!res.ok) throw new Error("Login failed, try again.");
      router.push("/dashboard");
    } catch (e: any) {
      setError(e.message || "Invalid code, try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">Portfolio</div>
        <div className="auth-sub">Sign in with your mobile number</div>

        {error && <div className="auth-error">{error}</div>}

        {step === "phone" && (
          <>
            <label className="field-label">Mobile number</label>
            <input
              className="field-input"
              placeholder="98765 43210"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <button className="btn" disabled={busy || !phone} onClick={sendOtp}>
              {busy ? "Sending…" : "Send OTP"}
            </button>
          </>
        )}

        {step === "otp" && (
          <>
            <label className="field-label">Enter the 6-digit code</label>
            <input
              className="field-input"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <button className="btn" disabled={busy || code.length < 6} onClick={verifyOtp}>
              {busy ? "Verifying…" : "Verify & continue"}
            </button>
          </>
        )}

        <div id="recaptcha-container" />
        <div className="auth-note">
          Uses Firebase phone authentication — no password is stored. Standard SMS
          rates may apply for the OTP.
        </div>
      </div>
    </div>
  );
}
