import { NextRequest, NextResponse } from "next/server";
import { firebaseAdminAuth } from "@/lib/firebaseAdmin";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: NextRequest) {
  const { idToken, phone } = await req.json();
  if (!idToken) return NextResponse.json({ error: "missing idToken" }, { status: 400 });

  // Verify the Firebase ID token, then mint a longer-lived session cookie.
  const decoded = await firebaseAdminAuth.verifyIdToken(idToken);
  const fiveDays = 60 * 60 * 24 * 5 * 1000;
  const sessionCookie = await firebaseAdminAuth.createSessionCookie(idToken, { expiresIn: fiveDays });

  // Upsert the user row so dhan_credentials / snapshots have somewhere to attach.
  await supabaseAdmin
    .from("users")
    .upsert(
      { firebase_uid: decoded.uid, phone: phone || decoded.phone_number },
      { onConflict: "firebase_uid" }
    );

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
