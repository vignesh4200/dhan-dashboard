import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { ingestMessage, type IncomingMessage } from "@/lib/cards/ingest";
import { collectAlerts, freshAlerts, loadAll } from "@/lib/cards/summary";
import { deliverAlerts } from "@/lib/cards/deliver";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Write-only ingest for the Gmail Apps Script (scripts/gmail-card-sync.gs).
// The script runs inside your own Gmail every 15 minutes and posts new HDFC
// emails here; nothing else can read your mailbox.
//
//   POST /api/cards/ingest?secret=CARD_INGEST_SECRET
//   Body: { messages: [{ id, from, subject, date, body, attachments?: [{ name, mimeType, data(base64) }] }] }
//   Reply: { results: [...], emails: [{ subject, text, html }] }  ← urgent alerts to send now
//
//   GET /api/cards/ingest?secret=...&need=statements
//   Reply: { ids: [...] } Gmail ids of statements whose PDF could not be read
//   yet (e.g. password added later); the script re-sends those.
function authorized(req: NextRequest) {
  const s = req.nextUrl.searchParams.get("secret");
  return !!process.env.CARD_INGEST_SECRET && s === process.env.CARD_INGEST_SECRET;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const messages: IncomingMessage[] = Array.isArray(body?.messages) ? body.messages : [];

  const results = [];
  for (const m of messages) {
    try { results.push(await ingestMessage(m)); }
    catch (e: any) { results.push({ id: m?.id, status: "error", detail: String(e?.message || e) }); }
  }
  await supabaseAdmin.from("cc_settings").update({ last_sync_at: new Date().toISOString() }).eq("id", 1);

  // Immediate alerts only (short payment, cash withdrawal). Date-based
  // reminders go out via /api/cards/reminders during the day.
  let emails: any[] = [];
  if (!body?.backfill) {
    const d = await loadAll();
    const fresh = await freshAlerts(collectAlerts(d, { remindersWindow: false }));
    emails = await deliverAlerts(fresh, req.nextUrl.origin);
  }
  return NextResponse.json({ results, emails });
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (req.nextUrl.searchParams.get("need") === "statements") {
    // Called on every run, so it also marks "synced" when no new mail came in.
    await supabaseAdmin.from("cc_settings").update({ last_sync_at: new Date().toISOString() }).eq("id", 1);
    const since = new Date(Date.now() - 200 * 86_400_000).toISOString();
    const { data } = await supabaseAdmin.from("cc_statements").select("external_id").eq("parsed_ok", false).gte("created_at", since).not("external_id", "like", "manual:%").limit(20);
    return NextResponse.json({ ids: (data || []).map((r: any) => r.external_id) });
  }
  return NextResponse.json({ ok: true });
}
