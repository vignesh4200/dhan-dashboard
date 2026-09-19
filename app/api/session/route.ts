import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdminAuth } from "@/lib/firebaseAdmin";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const ALLOWED_PHONE_E164 = "+919900678481";

export async function POST(req: NextRequest) {
  const { idToken, phone } = await req.json();
  if (!idToken) return NextResponse.json({ error: "missing idToken" }, { status: 400 });

  const adminAuth = getFirebaseAdminAuth();
  const decoded = await adminAuth.verifyIdToken(idToken);

  if (decoded.phone_number !== ALLOWED_PHONE_E164) {
    return NextResponse.json({ error: "This number isn't authorized for this dashboard." }, { status: 403 });
  }

  const fiveDays = 60 * 60 * 24 * 5 * 1000;
  const sessionCookie = await adminAuth.createSessionCookie(idToken, { expiresIn: fiveDays });

  const { error: upsertError } = await supabaseAdmin
    .from("users")
    .upsert(
      { firebase_uid: decoded.uid, phone: phone || decoded.phone_number },
      { onConflict: "firebase_uid" }
    );

  if (upsertError) {
    return NextResponse.json({ error: "Failed to save user record: " + upsertError.message }, { status: 500 });
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
