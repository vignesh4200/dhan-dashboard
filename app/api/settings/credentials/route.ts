import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { encryptSecret } from "@/lib/crypto";
import { validateDhanToken } from "@/lib/dhan";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data } = await supabaseAdmin
    .from("dhan_credentials")
    .select("dhan_client_id, updated_at")
    .eq("user_id", user.id)
    .single();

  return NextResponse.json({ configured: !!data, ...data });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { dhanClientId, dhanAccessToken, whatsappNumber } = await req.json();
  if (!dhanClientId || !dhanAccessToken) {
    return NextResponse.json({ error: "dhanClientId and dhanAccessToken are required" }, { status: 400 });
  }

  const valid = await validateDhanToken(dhanClientId, dhanAccessToken).catch(() => false);
  if (!valid) {
    return NextResponse.json(
      { error: "Dhan rejected this client ID / access token. Double-check and try again." },
      { status: 400 }
    );
  }

  await supabaseAdmin.from("dhan_credentials").upsert({
    user_id: user.id,
    dhan_client_id: dhanClientId,
    access_token_encrypted: encryptSecret(dhanAccessToken),
    updated_at: new Date().toISOString(),
  });

  if (whatsappNumber) {
    await supabaseAdmin.from("users").update({ whatsapp_number: whatsappNumber }).eq("id", user.id);
  }

  return NextResponse.json({ ok: true });
}
