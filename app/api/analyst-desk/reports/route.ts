import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isValidNseSymbol } from "@/lib/ingestAnalystDesk";
import { fireDeskRoutine, routineConfigured, toReport } from "@/lib/deskReports";

// On-demand Analyst Desk reports for the logged-in user. You pick stocks on
// /dashboard/analyst-desk; POST queues them and pokes the Claude Code routine,
// which writes the memos back through ./ingest. See lib/deskReports.ts.
export const dynamic = "force-dynamic";

async function latestHoldings(userId: string): Promise<any[]> {
  const { data: snap } = await supabaseAdmin
    .from("portfolio_snapshots")
    .select("holdings")
    .eq("user_id", userId)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return snap?.holdings || [];
}

// GET — your reports plus symbol suggestions (holdings + Smart Signals).
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const [{ data: reports, error }, holdings, { data: signals }, { data: calls }] = await Promise.all([
    supabaseAdmin
      .from("analyst_desk_reports")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50),
    latestHoldings(user.id),
    supabaseAdmin.from("smart_money_signals").select("symbol").order("disclosed_date", { ascending: false }).limit(200),
    supabaseAdmin.from("broker_calls").select("symbol").eq("user_id", user.id),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const clean = (rows: any[] | null) =>
    Array.from(new Set((rows || []).map((r) => String(r?.symbol || "").trim().toUpperCase()).filter(Boolean))).sort();
  const holdingSymbols = clean(holdings);
  const watchlistSymbols = clean([...(signals || []), ...(calls || [])]).filter((s) => !holdingSymbols.includes(s));

  return NextResponse.json({
    reports: (reports || []).map(toReport),
    suggestions: { holdings: holdingSymbols, watchlist: watchlistSymbols },
    routineConfigured: routineConfigured(),
  });
}

// POST { symbols: string[] } — queue reports and poke the routine.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const requested: string[] = Array.from(
    new Set(
      (Array.isArray(body?.symbols) ? body.symbols : [])
        .map((s: any) => String(s || "").trim().toUpperCase())
        .filter((s: string) => /^[A-Z0-9&\-]{1,20}$/.test(s))
    )
  ).slice(0, 10) as string[];
  if (requested.length === 0) return NextResponse.json({ error: "pick at least one NSE symbol" }, { status: 400 });

  // Don't queue a second copy of something already waiting or in progress.
  const { data: open } = await supabaseAdmin
    .from("analyst_desk_reports")
    .select("symbol")
    .eq("user_id", user.id)
    .in("status", ["queued", "running"])
    .in("symbol", requested);
  const alreadyOpen = new Set((open || []).map((r: any) => r.symbol));

  const candidates = requested.filter((s) => !alreadyOpen.has(s));
  const validity = await Promise.all(candidates.map((s) => isValidNseSymbol(s)));
  const invalid = candidates.filter((_, i) => !validity[i]);
  const toQueue = candidates.filter((_, i) => validity[i]);

  let queued: any[] = [];
  if (toQueue.length > 0) {
    const { data, error } = await supabaseAdmin
      .from("analyst_desk_reports")
      .insert(toQueue.map((symbol) => ({ user_id: user.id, symbol, status: "queued" })))
      .select("*");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    queued = data || [];
  }

  const fire = queued.length > 0 ? await fireDeskRoutine(toQueue) : { fired: false };

  return NextResponse.json({
    queued: queued.map(toReport),
    skipped: { alreadyQueued: Array.from(alreadyOpen), invalid },
    fired: fire.fired,
    fireError: "error" in fire ? fire.error : undefined,
  });
}

// DELETE ?id= — remove one of your reports.
export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isFinite(id)) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const { error } = await supabaseAdmin.from("analyst_desk_reports").delete().eq("id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: id });
}
