import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { deskSecretOk } from "@/lib/deskReports";

// Claim queued report requests — called by the Analyst Desk routine.
//
// POST https://your-app.vercel.app/api/analyst-desk/reports/queue
// Header: x-desk-secret: ANALYST_DESK_INGEST_SECRET
//
// Returns up to 8 requests and marks them 'running'. Rows left 'running' for
// over an hour (a run that died) are handed out again.
export const dynamic = "force-dynamic";

const RECLAIM_MS = 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  if (!deskSecretOk(req.headers.get("x-desk-secret"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const staleBefore = new Date(Date.now() - RECLAIM_MS).toISOString();
  const { data: rows, error } = await supabaseAdmin
    .from("analyst_desk_reports")
    .select("id, user_id, symbol, created_at")
    .or(`status.eq.queued,and(status.eq.running,claimed_at.lt.${staleBefore})`)
    .order("created_at", { ascending: true })
    .limit(8);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!rows || rows.length === 0) return NextResponse.json({ requests: [] });

  await supabaseAdmin
    .from("analyst_desk_reports")
    .update({ status: "running", claimed_at: new Date().toISOString() })
    .in("id", rows.map((r) => r.id));

  // Investor context per request: position (if held) and any logged broker call.
  const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
  const holdingsByUser = new Map<string, any[]>();
  const callsByUser = new Map<string, any[]>();
  await Promise.all(
    userIds.map(async (uid) => {
      const [{ data: snap }, { data: calls }] = await Promise.all([
        supabaseAdmin
          .from("portfolio_snapshots")
          .select("holdings")
          .eq("user_id", uid)
          .order("captured_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabaseAdmin.from("broker_calls").select("symbol, broker_name, call_type").eq("user_id", uid),
      ]);
      holdingsByUser.set(uid, snap?.holdings || []);
      callsByUser.set(uid, calls || []);
    })
  );

  const requests = rows.map((r) => {
    const holding = (holdingsByUser.get(r.user_id) || []).find((h: any) => String(h.symbol).toUpperCase() === r.symbol);
    const call = (callsByUser.get(r.user_id) || []).find((c: any) => String(c.symbol).toUpperCase() === r.symbol);
    return {
      id: r.id,
      symbol: r.symbol,
      requestedAt: r.created_at,
      held: holding ? { qty: holding.qty ?? null, avgCost: holding.avg ?? null } : null,
      brokerCall: call ? { broker: call.broker_name, callType: call.call_type } : null,
    };
  });

  return NextResponse.json({ requests });
}
