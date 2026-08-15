use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  ConfirmationResult,
} from "firebase/auth";
import { firebaseAuth } from "@/lib/firebaseClient";

export default function LoginPage() {
  const router = useRouter();

  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] =
    useState<ConfirmationResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // ONLY this phone number is allowed to login
  const ALLOWED_PHONE = "+919000678481";

  async function sendOtp() {
    setError("");
    setBusy(true);

    try {
      // Convert the entered number into E.164 format
      let e164 = phone.trim();

      if (e164.startsWith("+")) {
        // Remove spaces, brackets, hyphens, etc.
        e164 = "+" + e164.slice(1).replace(/\D/g, "");
      } else {
        // Assume Indian number if +91 is not entered
        const digits = e164.replace(/\D/g, "");

        if (digits.startsWith("91") && digits.length === 12) {
          e164 = "+" + digits;
        } else {
          e164 = "+91" + digits;
        }
      }

      // IMPORTANT:
      // Do not even call Firebase if the number is not authorized.
      if (e164 !== ALLOWED_PHONE) {
        throw new Error(
          "This phone number is not authorized to access the dashboard."
        );
      }

      // Invisible reCAPTCHA required by Firebase Phone Authentication
      const verifier = new RecaptchaVerifier(
        firebaseAuth,
        "recaptcha-container",
        {
          size: "invisible",
        }
      );

      // Firebase OTP is requested ONLY after the number passes
      // the authorized-number check above.
      const result = await signInWithPhoneNumber(
        firebaseAuth,
        e164,
        verifier
      );

      setConfirmation(result);
      setStep("otp");
    } catch (e: any) {
      setError(
        e?.message ||
          "Couldn't send the code. Check the number and try again."
      );
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp() {
    setError("");
    setBusy(true);

    try {
      if (!confirmation) {
        throw new Error("Session expired. Please request a new code.");
      }

      const cred = await confirmation.confirm(code);

      // Extra safety check after Firebase authentication
      if (cred.user.phoneNumber !== ALLOWED_PHONE) {
        await firebaseAuth.signOut();
        throw new Error(
          "This phone number is not authorized to access the dashboard."
        );
      }

      const idToken = await cred.user.getIdToken();

      const res = await fetch("/api/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          idToken,
          phone: cred.user.phoneNumber,
        }),
      });

      if (!res.ok) {
        throw new Error("Login failed. You are not authorized.");
      }

      router.push("/dashboard");
    } catch (e: any) {
      setError(e?.message || "Invalid code, try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">Portfolio</div>

        <div className="auth-sub">
          Sign in with your mobile number
        </div>

        {error && (
          <div className="auth-error">
            {error}
          </div>
        )}

        {step === "phone" && (
          <>
            <label className="field-label">
              Mobile number
            </label>

            <input
              className="field-input"
              placeholder="98765 43210"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              autoComplete="tel"
            />

            <button
              className="btn"
              disabled={busy || !phone.trim()}
              onClick={sendOtp}
            >
              {busy ? "Sending..." : "Send OTP"}
            </button>
          </>
        )}

        {step === "otp" && (
          <>
            <label className="field-label">
              Enter the 6-digit code
            </label>

            <input
              className="field-input"
              placeholder="123456"
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
            />

            <button
              className="btn"
              disabled={busy || code.length < 6}
              onClick={verifyOtp}
            >
              {busy ? "Verifying..." : "Verify & continue"}
            </button>
          </>
        )}

        <div id="recaptcha-container" />

        <div className="auth-note">
          Uses Firebase phone authentication — no password is stored.
          Standard SMS rates may apply for the OTP.
        </div>
      </div>
    </div>
  );
}
