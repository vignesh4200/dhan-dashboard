import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { decryptSecret } from "@/lib/crypto";
import { getDhanOrders } from "@/lib/dhan";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data: creds } = await supabaseAdmin
    .from("dhan_credentials")
    .select("dhan_client_id, access_token_encrypted")
    .eq("user_id", user.id)
    .single();

  if (!creds) return NextResponse.json({ orders: [] });

  try {
    const accessToken = decryptSecret(creds.access_token_encrypted);
    const orders = await getDhanOrders(creds.dhan_client_id, accessToken);
    return NextResponse.json({ orders });
  } catch (e: any) {
    return NextResponse.json({ orders: [], error: e.message });
  }
}
