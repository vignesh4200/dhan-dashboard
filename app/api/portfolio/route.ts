import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data } = await supabaseAdmin
    .from("portfolio_snapshots")
    .select("*")
    .eq("user_id", user.id)
    .order("captured_at", { ascending: false })
    .limit(1)
    .single();

  if (!data) {
    return NextResponse.json({
      empty: true,
      message: "No snapshot yet — add your Dhan credentials in Settings, then wait for the next 15-minute refresh.",
    });
  }
  return NextResponse.json(data);
}
