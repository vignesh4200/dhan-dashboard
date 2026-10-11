// Sends alerts via the Telegram Bot API — free, no business verification,
// no message-template approval (unlike WhatsApp Cloud API). Setup:
//   1. Message @BotFather on Telegram, send /newbot, follow the prompts.
//      BotFather gives you a token like "123456789:AAE...".
//   2. Message your new bot anything (e.g. "hi") so it can see your chat.
//   3. Visit https://api.telegram.org/bot<TOKEN>/getUpdates in a browser —
//      the JSON reply has your numeric chat id at result[0].message.chat.id.
//   4. Put the token in Vercel as TELEGRAM_BOT_TOKEN, and the chat id in
//      Settings on the dashboard (stored per-user in the users table).

const API_BASE = "https://api.telegram.org";

export function isTelegramConfigured(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN;
}

export async function sendTelegramMessage(params: { chatId: string; text: string }) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN env var missing.");
  }

  const res = await fetch(`${API_BASE}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: params.chatId,
      text: params.text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Telegram send failed: ${res.status} ${errBody}`);
  }
  return res.json();
}

// Convenience wrapper matching the shape alert-sending call sites already use.
export async function sendTelegramAlert(params: {
  chatId: string;
  symbol: string;
  pnlPct: number;
  message: string;
}) {
  const emoji = params.pnlPct >= 8 ? "🎯" : "👀";
  return sendTelegramMessage({
    chatId: params.chatId,
    text: `${emoji} <b>${params.symbol}</b> ${params.message}`,
  });
}
