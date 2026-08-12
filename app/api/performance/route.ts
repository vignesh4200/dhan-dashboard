import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data } = await supabaseAdmin
    .from("portfolio_snapshots")
    .select("captured_at, total_current")
    .eq("user_id", user.id)
    .order("captured_at", { ascending: true })
    .limit(200);

  return NextResponse.json({ points: data || [] });
}
