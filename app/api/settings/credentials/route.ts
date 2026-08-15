import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { encryptSecret } from "@/lib/crypto";
import { generateAccessTokenViaTotp } from "@/lib/dhan";
import { generateTotpCode } from "@/lib/totp";

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

  const { dhanClientId, dhanPin, totpSecret, whatsappNumber } = await req.json();
  if (!dhanClientId || !dhanPin || !totpSecret) {
    return NextResponse.json({ error: "Client ID, PIN, and TOTP secret are all required" }, { status: 400 });
  }

  const code = generateTotpCode(totpSecret);
  const result = await generateAccessTokenViaTotp(dhanClientId, dhanPin, code);

  if ("error" in result) {
    return NextResponse.json(
      { error: "Dhan rejected these credentials: " + result.error },
      { status: 400 }
    );
  }

  await supabaseAdmin.from("dhan_credentials").upsert({
    user_id: user.id,
    dhan_client_id: dhanClientId,
    dhan_pin_encrypted: encryptSecret(dhanPin),
    totp_secret_encrypted: encryptSecret(totpSecret),
    access_token_encrypted: encryptSecret(result.accessToken),
    updated_at: new Date().toISOString(),
  });

  if (whatsappNumber) {
    await supabaseAdmin.from("users").update({ whatsapp_number: whatsappNumber }).eq("id", user.id);
  }

  return NextResponse.json({ ok: true });
}
