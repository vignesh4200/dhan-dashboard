// Sends WhatsApp alerts via Meta's official WhatsApp Cloud API (direct, no reseller).
// Setup: https://developers.facebook.com/docs/whatsapp/cloud-api/get-started
//
// IMPORTANT: Meta only allows free-form text messages within 24h of the user
// messaging your business number first. For business-initiated alerts (which is
// what a profit-booking ping is), you must send a pre-approved message TEMPLATE.
//
// Steps before this works:
//   1. Create a WhatsApp Business Account + app in Meta Business Manager (free).
//   2. In Message Templates, create a template named e.g. "profit_alert"
//      (category: Utility) with body like:
//        "{{1}} is up {{2}}% — {{3}}. Check your dashboard to review."
//      Submit it for approval (usually minutes to a few hours).
//   3. Put your Phone Number ID + permanent access token in .env.

const GRAPH_VERSION = "v20.0";

// Lets the cron job check before trying to send, instead of throwing.
// Useful while you haven't finished WhatsApp setup yet — alerts still show
// on the dashboard, they just won't be pushed to your phone until this
// returns true.
export function isWhatsAppConfigured(): boolean {
  return !!(process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN);
}

export async function sendWhatsAppAlert(params: {
  toPhoneE164: string; // e.g. "+919876543210"
  symbol: string;
  pnlPct: number;
  message: string;
}) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME || "profit_alert";

  if (!phoneNumberId || !token) {
    throw new Error("WhatsApp env vars missing (WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN).");
  }

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: params.toPhoneE164.replace("+", ""),
        type: "template",
        template: {
          name: templateName,
          language: { code: "en" },
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: params.symbol },
                { type: "text", text: params.pnlPct.toFixed(1) },
                { type: "text", text: params.message },
              ],
            },
          ],
        },
      }),
    }
  );

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`WhatsApp send failed: ${res.status} ${errBody}`);
  }
  return res.json();
}
