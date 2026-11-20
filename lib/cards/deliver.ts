import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isTelegramConfigured, sendTelegramMessage } from "@/lib/telegram";
import type { Alert } from "./summary";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Turns alerts into ready-to-send emails (the Gmail Apps Script sends them from
// your own inbox) and, when Telegram is already set up for the dashboard's
// other alerts, pushes them there too.
export async function deliverAlerts(alerts: Alert[], appUrl: string) {
  if (!alerts.length) return [];
  const icon = (a: Alert) => (a.level === "urgent" ? "🔴" : a.level === "warn" ? "🟠" : "🔵");

  if (isTelegramConfigured()) {
    const { data: users } = await supabaseAdmin.from("users").select("telegram_chat_id").not("telegram_chat_id", "is", null);
    for (const u of users || []) {
      for (const a of alerts) {
        try {
          await sendTelegramMessage({ chatId: u.telegram_chat_id, text: `${icon(a)} <b>${esc(a.title)}</b>\n${esc(a.body)}` });
        } catch { /* email still goes out */ }
      }
    }
  }

  return alerts.map((a) => ({
    subject: `${icon(a)} ${a.title}`,
    text: `${a.body}\n\nOpen: ${appUrl}/dashboard/cards`,
    html:
      `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#111">` +
      `<p style="font-size:17px;font-weight:bold;margin:0 0 8px">${esc(a.title)}</p>` +
      `<p style="margin:0 0 14px">${esc(a.body)}</p>` +
      `<a href="${appUrl}/dashboard/cards" style="display:inline-block;background:#c99a48;color:#1a1306;padding:10px 16px;border-radius:999px;text-decoration:none;font-weight:bold">Open Credit Cards</a>` +
      `<p style="color:#666;font-size:12px;margin-top:18px">Sent by your Dhan Vault credit card tracker.</p></div>`,
  }));
}
