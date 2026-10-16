"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  ConfirmationResult,
} from "firebase/auth";
import { firebaseAuth } from "@/lib/firebaseClient";
import s from "./vault.module.css";

// This is a personal single-user dashboard — only this exact number is
// allowed to log in. No OTP is even requested for any other number, so no
// SMS cost or attempt is wasted on wrong/random numbers. Change this if
// your own number ever changes.
const ALLOWED_PHONE_E164 = "+919900678481";

// Dial teeth around the vault wheel (48 teeth, every 4th one longer).
const TEETH = Array.from({ length: 48 }, (_, i) => ({ angle: (i * 360) / 48, long: i % 4 === 0 }));

type Led = "idle" | "amber" | "green" | "red";

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  // Vault animation state
  const [led, setLed] = useState<Led>("idle");
  const [shake, setShake] = useState(false);
  const [unlocking, setUnlocking] = useState(false); // dial spins
  const [unbolted, setUnbolted] = useState(false); // bolts retract
  const [opened, setOpened] = useState(false); // door swings open

  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);
  const verifierRef = useRef<RecaptchaVerifier | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (fn: () => void, ms: number) => timers.current.push(setTimeout(fn, ms));

  const code = digits.join("");
  const phoneDigits = phone.replace(/\D/g, "");

  function fail(message: string) {
    setError(message);
    setLed("red");
    setShake(false);
    requestAnimationFrame(() => setShake(true));
    later(() => setLed((l) => (l === "red" ? (step === "otp" ? "amber" : "idle") : l)), 900);
  }

  async function sendOtp() {
    setError("");
    const e164 = phone.startsWith("+") ? phone.replace(/\s/g, "") : `+91${phoneDigits}`;

    if (e164 !== ALLOWED_PHONE_E164) {
      fail("This number isn't authorized for this dashboard.");
      return;
    }

    setBusy(true);
    try {
      // Invisible reCAPTCHA container, required by Firebase phone auth.
      // Clear any earlier one so "Change number" then resend doesn't fail
      // with "reCAPTCHA has already been rendered".
      verifierRef.current?.clear();
      const verifier = new RecaptchaVerifier(firebaseAuth, "recaptcha-container", {
        size: "invisible",
      });
      verifierRef.current = verifier;
      const result = await signInWithPhoneNumber(firebaseAuth, e164, verifier);
      setConfirmation(result);
      setStep("otp");
      setLed("amber");
      setInfo(`Code sent to ${e164.replace(/^\+91/, "+91 ")}.`);
      later(() => otpRefs.current[0]?.focus(), 50);
    } catch (e: any) {
      fail(e.message || "Couldn't send the code. Check the number and try again.");
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

      // Success: spin the dial, pull the bolts, swing the door, then go in.
      setLed("green");
      setInfo("Access granted.");
      const reduced =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduced) {
        router.push("/dashboard");
        return;
      }
      setUnlocking(true);
      later(() => setUnbolted(true), 900);
      later(() => setOpened(true), 1400);
      later(() => router.push("/dashboard"), 2700);
    } catch (e: any) {
      setDigits(["", "", "", "", "", ""]);
      later(() => otpRefs.current[0]?.focus(), 50);
      fail(e.message || "Invalid code, try again.");
      setBusy(false);
      return;
    }
    // Keep the button locked while the door animation plays.
  }

  function onPhoneChange(v: string) {
    if (v.trim().startsWith("+")) {
      setPhone(v);
      return;
    }
    const d = v.replace(/\D/g, "").slice(0, 10);
    setPhone(d.length > 5 ? `${d.slice(0, 5)} ${d.slice(5)}` : d);
  }

  function onDigit(i: number, v: string) {
    const ch = v.replace(/\D/g, "").slice(-1);
    setDigits((prev) => {
      const next = [...prev];
      next[i] = ch;
      return next;
    });
    if (ch && i < 5) otpRefs.current[i + 1]?.focus();
  }

  function onDigitKey(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[i] && i > 0) otpRefs.current[i - 1]?.focus();
    if (e.key === "Enter" && code.length === 6 && !busy) verifyOtp();
  }

  function onOtpPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const t = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!t) return;
    e.preventDefault();
    const next = ["", "", "", "", "", ""];
    t.split("").forEach((c, j) => (next[j] = c));
    setDigits(next);
    otpRefs.current[Math.min(t.length, 5)]?.focus();
  }

  function changeNumber() {
    setStep("phone");
    setDigits(["", "", "", "", "", ""]);
    setConfirmation(null);
    setError("");
    setInfo("");
    setLed("idle");
  }

  const phoneReady = phone.startsWith("+") ? phone.replace(/\D/g, "").length >= 10 : phoneDigits.length === 10;
  const done = led === "green";

  const ledClass = `${s.led} ${led === "amber" ? s.amber : led === "green" ? s.green : led === "red" ? s.red : ""}`;
  const doorClass = [
    s.door,
    shake ? s.shake : "",
    unlocking ? s.spin : "",
    unbolted ? s.unbolt : "",
    opened ? s.open : "",
  ].join(" ");

  return (
    <div className={s.shell}>
      <div className={s.brand}>
        <h1>
          Dhan <span>Vault</span>
        </h1>
        <p>Sign in with your mobile number</p>
      </div>

      <div className={s.vault}>
        <div className={s.chamber} aria-hidden="true">
          <div className={s.granted}>Access granted</div>
          <div className={s.bars}>
            <div className={`${s.bar} ${s.crown}`} />
            <div className={s.bar} />
            <div className={s.bar} />
            <div className={s.bar} />
          </div>
          <div className={s.going}>Opening your dashboard…</div>
        </div>

        <div className={doorClass} onAnimationEnd={() => setShake(false)}>
          <span className={`${s.rivet} ${s.r1}`} />
          <span className={`${s.rivet} ${s.r2}`} />
          <span className={`${s.rivet} ${s.r3}`} />
          <span className={`${s.rivet} ${s.r4}`} />
          <span className={`${s.hinge} ${s.h1}`} />
          <span className={`${s.hinge} ${s.h2}`} />
          <div className={s.bolts}>
            <span className={s.bolt} />
            <span className={s.bolt} />
            <span className={s.bolt} />
          </div>

          <div className={s.head}>
            <span className={s.lbl}>Vault code · Step {step === "phone" ? 1 : 2} of 2</span>
            <span className={ledClass} />
          </div>

          <div className={s.dialWrap}>
            <svg className={s.dial} viewBox="-80 -80 160 160" aria-hidden="true">
              <defs>
                <radialGradient id="vaultDialGrad" cx="35%" cy="30%">
                  <stop offset="0" stopColor="#5b616d" />
                  <stop offset="1" stopColor="#1d2026" />
                </radialGradient>
              </defs>
              <circle r="76" fill="#14161b" />
              {TEETH.map((t, i) => (
                <rect
                  key={i}
                  x={-2}
                  y={-75}
                  width={4}
                  height={t.long ? 16 : 10}
                  fill="#4b515d"
                  transform={`rotate(${t.angle})`}
                />
              ))}
              <circle r="54" fill="url(#vaultDialGrad)" stroke="#0008" strokeWidth="2" />
              <g stroke="#2a2e36" strokeWidth="7" strokeLinecap="round">
                <line x1="0" y1="-46" x2="0" y2="46" />
                <line x1="-46" y1="0" x2="46" y2="0" />
              </g>
              <circle r="16" fill="#3a3f4a" stroke="#0007" strokeWidth="2" />
              <circle r="5" fill="#e5a93a" />
              <polygon points="0,-74 -5,-66 5,-66" fill="#e5a93a" />
            </svg>
          </div>

          <div className={s.panel}>
            {step === "phone" && (
              <div className={s.screen}>
                {!phone.startsWith("+") && <span className={s.cc}>+91</span>}
                <input
                  id="login-phone"
                  aria-label="Mobile number"
                  inputMode="tel"
                  autoComplete="tel-national"
                  placeholder="98765 43210"
                  value={phone}
                  onChange={(e) => onPhoneChange(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && phoneReady && !busy && sendOtp()}
                />
              </div>
            )}

            {step === "otp" && (
              <div className={s.otp}>
                {digits.map((d, i) => (
                  <input
                    key={i}
                    id={`login-otp-${i}`}
                    ref={(el) => {
                      otpRefs.current[i] = el;
                    }}
                    aria-label={`Digit ${i + 1}`}
                    inputMode="numeric"
                    autoComplete={i === 0 ? "one-time-code" : "off"}
                    maxLength={1}
                    value={d}
                    disabled={done}
                    onChange={(e) => onDigit(i, e.target.value)}
                    onKeyDown={(e) => onDigitKey(i, e)}
                    onPaste={onOtpPaste}
                  />
                ))}
              </div>
            )}

            <div className={`${s.msg} ${error ? s.bad : ""}`} role="status">
              {error || info || "Only the registered number can open this vault."}
            </div>

            {step === "phone" ? (
              <button className={s.unlock} disabled={busy || !phoneReady} onClick={sendOtp}>
                {busy ? "Sending…" : "Send OTP"}
              </button>
            ) : (
              <button className={s.unlock} disabled={busy || done || code.length < 6} onClick={verifyOtp}>
                {done ? "Unlocked" : busy ? "Verifying…" : "Unlock"}
              </button>
            )}

            {step === "otp" && !done && (
              <button className={s.link} onClick={changeNumber}>
                Change number
              </button>
            )}
          </div>
        </div>
      </div>

      <div id="recaptcha-container" />
      <div className={s.note}>
        Uses Firebase phone authentication — no password is stored. Standard SMS rates may
        apply for the OTP.
      </div>
    </div>
  );
}
