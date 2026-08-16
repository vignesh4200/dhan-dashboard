import { NextRequest, NextResponse } from "next/server";
import { firebaseAdminAuth } from "@/lib/firebaseAdmin";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// This is a personal single-user dashboard — only this exact number is ever
// allowed to actually get a session, regardless of what the client sends.
// This check uses decoded.phone_number, which comes from Firebase's own
// server-side token verification below, not anything the browser claims —
// so it can't be bypassed by tampering with the client.
const ALLOWED_PHONE_E164 = "+919900678481";

export async function POST(req: NextRequest) {
  const { idToken, phone } = await req.json();
  if (!idToken) return NextResponse.json({ error: "missing idToken" }, { status: 400 });

  // Verify the Firebase ID token, then mint a longer-lived session cookie.
  const decoded = await firebaseAdminAuth.verifyIdToken(idToken);

  if (decoded.phone_number !== ALLOWED_PHONE_E164) {
    return NextResponse.json({ error: "This number isn't authorized for this dashboard." }, { status: 403 });
  }

  const fiveDays = 60 * 60 * 24 * 5 * 1000;
  const sessionCookie = await firebaseAdminAuth.createSessionCookie(idToken, { expiresIn: fiveDays });

  // Upsert the user row so dhan_credentials / snapshots have somewhere to attach.
  const { error: upsertError } = await supabaseAdmin
    .from("users")
    .upsert(
      { firebase_uid: decoded.uid, phone: phone || decoded.phone_number },
      { onConflict: "firebase_uid" }
    );

  if (upsertError) {
    return NextResponse.json(
      { error: "Failed to save user record: " + upsertError.message },
      { status: 500 }
    );
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set("session", sessionCookie, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: fiveDays / 1000,
    path: "/",
  });
  return res;
}
