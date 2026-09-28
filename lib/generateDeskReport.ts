import Anthropic from "@anthropic-ai/sdk";

// On-demand Analyst Desk report: one Claude call per stock, with live web
// search, written as an institutional investment-committee memo that ends in
// a clear decision. Replaces the old scheduled multi-agent routine — the
// user now picks the stocks from the Analyst Desk page instead.

const MODEL = "claude-opus-5";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY

export const DECISIONS = ["BUY", "ACCUMULATE", "HOLD", "AVOID", "SELL"] as const;
export type Decision = (typeof DECISIONS)[number];

export type DeskReportContext = {
  symbol: string;
  inHoldings: boolean;
  holdingQty: number | null;
  avgCost: number | null;
  brokerRec: { brokerName: string | null; callType: string } | null;
};

export type DeskReportResult = {
  company: string | null;
  decision: Decision | null;
  conviction: number | null;
  currentPrice: number | null;
  fairValueLow: number | null;
  fairValueHigh: number | null;
  horizon: string | null;
  summary: string | null;
  reportMarkdown: string;
  sources: string[];
  model: string;
};

const SYSTEM = `You are the Chief Investment Officer of an Indian institutional equity fund, writing a decision memo for the fund's CEO and investment committee on a single NSE-listed stock. The CEO reads the first screen and decides; everything below it is the evidence.

Research the stock with web search before writing. Prefer primary and reputable sources: NSE/BSE filings and shareholding patterns, company investor-relations pages and concall transcripts, annual reports, Screener.in, Trendlyne, Moneycontrol, Economic Times, Business Standard, Mint, CRISIL/ICRA/CARE rating actions. Use the latest available quarterly results and the current market price. When a figure could not be verified, say so rather than estimating silently.

Write the memo in Markdown with exactly these sections, in this order:

# <Company name> (<SYMBOL>) — Investment Committee Memo
**Decision: <BUY | ACCUMULATE | HOLD | AVOID | SELL>** · Conviction <0-100>/100 · CMP ₹<price> · Fair value ₹<low>–₹<high> · Horizon <e.g. 12–18 months>

## 1. Executive summary
Three to five sentences a CEO can act on: the decision, the single most important reason, the biggest risk, and what would change the call.

## 2. Business & moat
## 3. Financial performance (last 8 quarters / 3 years)
Include a compact Markdown table of revenue, EBITDA margin, PAT and ROCE/ROE where available.
## 4. Management, governance & forensic checks
Promoter holding and pledges, related-party transactions, auditor remarks, capital allocation track record, guidance vs. delivery.
## 5. Industry & macro backdrop
## 6. Valuation vs. peers
Compact table comparing P/E, EV/EBITDA, P/B and growth against 2–4 listed peers, then the fair-value range and how it was derived.
## 7. Bull case / Bear case
## 8. Ownership, flows & recent news
FII/DII/MF trend, bulk/block deals, insider (SAST) filings, material news from the last 90 days.
## 9. Key risks & what would change our view
## 10. Recommendation & action plan
Entry zone, position sizing guidance (e.g. starter vs. full position), review triggers and stop/exit conditions. If the investor already holds the stock, address whether to add, hold or trim.

Be balanced and specific — numbers over adjectives. Keep it tight: a busy CEO should finish it in under ten minutes.

After the memo, output a fenced \`\`\`json block (and nothing after it) with this exact shape:
{"company": string, "decision": "BUY"|"ACCUMULATE"|"HOLD"|"AVOID"|"SELL", "conviction": number, "currentPrice": number|null, "fairValueLow": number|null, "fairValueHigh": number|null, "horizon": string|null, "summary": string}
"summary" is one sentence stating the decision and the main reason.`;

function userPrompt(ctx: DeskReportContext, today: string) {
  const lines = [
    `Prepare the investment committee memo for NSE: ${ctx.symbol}. Today is ${today}.`,
    "",
    "Investor context:",
    ctx.inHoldings
      ? `- Already held: ${ctx.holdingQty ?? "?"} shares${ctx.avgCost != null ? ` at an average cost of ₹${ctx.avgCost}` : ""}.`
      : "- Not currently held — this is a fresh buy decision.",
    ctx.brokerRec
      ? `- A logged broker call: ${ctx.brokerRec.callType.toUpperCase()}${ctx.brokerRec.brokerName ? ` from ${ctx.brokerRec.brokerName}` : ""}. Treat it as one input, not a conclusion.`
      : "- No broker call logged for this stock.",
  ];
  return lines.join("\n");
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

function parseTrailer(text: string) {
  const matches = Array.from(text.matchAll(/```json\s*([\s\S]*?)```/g));
  const last = matches[matches.length - 1];
  if (!last) return { body: text.trim(), meta: null as any };
  let meta: any = null;
  try {
    meta = JSON.parse(last[1]);
  } catch {
    meta = null;
  }
  const body = (text.slice(0, last.index) + text.slice((last.index ?? 0) + last[0].length)).trim();
  return { body, meta };
}

export async function generateDeskReport(ctx: DeskReportContext): Promise<DeskReportResult> {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: userPrompt(ctx, today) }];
  const content: Anthropic.Beta.BetaContentBlock[] = [];
  let servedBy = MODEL;

  // Web search runs server-side; a long research turn can come back as
  // pause_turn, which is resumed by sending the partial assistant turn back.
  for (let i = 0; i < 4; i++) {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system: SYSTEM,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 12, user_location: { type: "approximate", country: "IN" } }],
      messages,
    });
    const response = await stream.finalMessage();
    servedBy = response.model;
    content.push(...response.content);

    if (response.stop_reason === "refusal") {
      throw new Error("The model declined to write this report.");
    }
    if (response.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: response.content });
  }

  const text = content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  if (!text.trim()) throw new Error("The model returned an empty report.");

  const sources = new Set<string>();
  for (const b of content) {
    if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const r of b.content) if (r.type === "web_search_result") sources.add(r.url);
    }
  }

  const { body, meta } = parseTrailer(text);
  const decision = DECISIONS.find((d) => d === String(meta?.decision ?? "").toUpperCase()) ?? null;

  return {
    company: str(meta?.company),
    decision,
    conviction: num(meta?.conviction),
    currentPrice: num(meta?.currentPrice),
    fairValueLow: num(meta?.fairValueLow),
    fairValueHigh: num(meta?.fairValueHigh),
    horizon: str(meta?.horizon),
    summary: str(meta?.summary),
    reportMarkdown: body,
    sources: Array.from(sources).slice(0, 30),
    model: servedBy,
  };
}
