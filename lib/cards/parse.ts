// Parsers for HDFC Bank alert emails (alerts@hdfcbank.bank.in).
// Formats checked against real emails, Nov 2026. Each parser returns null when
// the text does not match, so an unknown format is skipped, never mis-filed.

export type ParsedTxn = {
  kind:
    | "purchase"
    | "refund"
    | "cash"
    | "payment"
    | "mandate_paid"
    | "mandate_upcoming"
    | "mandate_declined"
    | "bank_debit"
    | "bank_credit";
  cardLast4: string | null;
  amount: number;
  merchant: string | null;
  txnAt: string; // ISO
  bankBalance?: number | null;
};

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

export function toAmount(s: string | null | undefined): number | null {
  if (!s) return null;
  const n = Number(String(s).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// Builds an ISO timestamp from IST wall-clock parts.
function istIso(y: number, m: number, d: number, hh = 12, mm = 0, ss = 0): string {
  return new Date(Date.UTC(y, m, d, hh, mm, ss) - 330 * 60 * 1000).toISOString();
}

// "08 Apr, 2026" | "08 Apr 2026"
export function parseDayMonYear(s: string): { y: number; m: number; d: number } | null {
  const r = /(\d{1,2})\s+([A-Za-z]{3})[a-z]*,?\s+(\d{4})/.exec(s);
  if (!r) return null;
  const m = MONTHS[r[2].toLowerCase()];
  if (m === undefined) return null;
  return { y: +r[3], m, d: +r[1] };
}

// "07/11/2026" | "07-11-2026" | "16-11-26"
export function parseDmy(s: string): { y: number; m: number; d: number } | null {
  const r = /(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/.exec(s);
  if (!r) return null;
  let y = +r[3];
  if (y < 100) y += 2000;
  return { y, m: +r[2] - 1, d: +r[1] };
}

export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|td|li)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ");
}

const CARD_PAYEE = /\bcred\b|credit ?card|hdfc ?cc|ccpay|card ?bill|cc ?bill|billdesk.*card/i;

export function parseHdfcAlert(rawText: string, receivedAt: string): ParsedTxn | null {
  const t = rawText.replace(/\s+/g, " ");
  let r: RegExpExecArray | null;

  // Credit card purchase.
  r = /Rs\.?\s?([\d,]+(?:\.\d+)?) is debited from your HDFC Bank Credit Card ending (\d{4}) towards (.+?) on (\d{1,2} [A-Za-z]{3},? \d{4})(?: at (\d{2}):(\d{2}):(\d{2}))?/i.exec(t);
  if (r) {
    const d = parseDayMonYear(r[4]);
    const merchant = r[3].trim();
    const isCash = /\batm\b|cash ?withdraw/i.test(merchant);
    return {
      kind: isCash ? "cash" : "purchase",
      cardLast4: r[2],
      amount: toAmount(r[1])!,
      merchant,
      txnAt: d ? istIso(d.y, d.m, d.d, +(r[5] || 12), +(r[6] || 0), +(r[7] || 0)) : receivedAt,
    };
  }

  // Credit card refund / reversal / payment credited to the card.
  r = /Rs\.?\s?([\d,]+(?:\.\d+)?) (?:has been |is )?(?:credited|received|refunded|reversed) (?:to|on|in) your HDFC Bank Credit Card ending (\d{4})(?: (?:from|towards|by) (.+?))?(?: on (\d{1,2} [A-Za-z]{3},? \d{4}|\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}))?[.\s]/i.exec(t)
    || /payment of Rs\.?\s?([\d,]+(?:\.\d+)?) .*?(?:Credit Card|card) ending (\d{4})/i.exec(t);
  if (r) {
    const isPayment = /payment|paid|thank you for (?:the )?payment/i.test(t) && !/refund|reversal|reversed/i.test(t);
    const d = r[4] ? parseDayMonYear(r[4]) || parseDmy(r[4]) : null;
    return {
      kind: isPayment ? "payment" : "refund",
      cardLast4: r[2],
      amount: toAmount(r[1])!,
      merchant: r[3]?.trim() || (isPayment ? "Card payment" : "Refund"),
      txnAt: d ? istIso(d.y, d.m, d.d) : receivedAt,
    };
  }

  // E-mandate (AutoPay) upcoming.
  r = /upcoming E-mandate \(Auto payment\) of INR ([\d,]+(?:\.\d+)?) for (.+?)\. Amount will be debited from your HDFC Bank Credit Card ending (\d{4}) on (\d{1,2}\/\d{1,2}\/\d{4})/i.exec(t);
  if (r) {
    const d = parseDmy(r[4]);
    return { kind: "mandate_upcoming", cardLast4: r[3], amount: toAmount(r[1])!, merchant: r[2].trim(), txnAt: d ? istIso(d.y, d.m, d.d) : receivedAt };
  }

  // E-mandate declined.
  r = /AutoPay payment for (.+?), set on your HDFC Bank Credit Card ending (\d{4}), was declined.*?Amount: INR ([\d,]+(?:\.\d+)?).*?Date: (\d{1,2}\/\d{1,2}\/\d{4})/i.exec(t);
  if (r) {
    const d = parseDmy(r[4]);
    return { kind: "mandate_declined", cardLast4: r[2], amount: toAmount(r[3])!, merchant: r[1].trim(), txnAt: d ? istIso(d.y, d.m, d.d) : receivedAt };
  }

  // E-mandate paid (counts as card spend).
  r = /Your (.+?) bill, set up through E-mandate \(Auto payment\), has been successfully paid using your HDFC Bank Credit Card ending (\d{4}).*?Amount: INR ([\d,]+(?:\.\d+)?).*?Date: (\d{1,2}\/\d{1,2}\/\d{4})/i.exec(t);
  if (r) {
    const d = parseDmy(r[4]);
    return { kind: "mandate_paid", cardLast4: r[2], amount: toAmount(r[3])!, merchant: r[1].trim(), txnAt: d ? istIso(d.y, d.m, d.d) : receivedAt };
  }

  // Savings account UPI debit. A debit to a card-bill payee is a card payment.
  r = /Rs\.?\s?([\d,]+(?:\.\d+)?) (?:has been |is )?debited from (?:your )?(?:HDFC Bank )?(?:account|a\/c) (?:ending |\*\*)?(?:in )?(\d{4}) to(?:wards)? (?:VPA )?(\S+)(?: \(([^)]*)\))? on (\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/i.exec(t);
  if (r) {
    const d = parseDmy(r[5]);
    const payee = `${r[4] || ""} ${r[3] || ""}`.trim();
    const isCardPay = CARD_PAYEE.test(payee);
    return {
      kind: isCardPay ? "payment" : "bank_debit",
      cardLast4: null,
      amount: toAmount(r[1])!,
      merchant: (r[4] || r[3] || "").trim() || null,
      txnAt: d ? istIso(d.y, d.m, d.d) : receivedAt,
      bankBalance: balanceIn(t),
    };
  }

  // Savings account credit.
  r = /Rs\.?\s?([\d,]+(?:\.\d+)?) has been (?:successfully )?credited to your HDFC Bank account ending (?:in )?(\d{4})/i.exec(t);
  if (r) {
    const dm = /Date:\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/i.exec(t);
    const d = dm ? parseDmy(dm[1]) : null;
    const sender = /Sender:\s*([^(]+?)\s*\(/i.exec(t);
    return {
      kind: "bank_credit",
      cardLast4: null,
      amount: toAmount(r[1])!,
      merchant: sender ? sender[1].trim() : null,
      txnAt: d ? istIso(d.y, d.m, d.d) : receivedAt,
      bankBalance: balanceIn(t),
    };
  }

  // Debit card ATM withdrawal / POS (quotes the account balance after the txn).
  r = /HDFC Bank Debit Card ending (\d{4}) for (ATM withdrawal|.+?) for Rs\.?\s?([\d,]+(?:\.\d+)?)(?: in [^]*?)? on (\d{1,2}-\d{1,2}-\d{4})/i.exec(t);
  if (r) {
    const d = parseDmy(r[4]);
    return {
      kind: "bank_debit",
      cardLast4: null,
      amount: toAmount(r[3])!,
      merchant: /atm/i.test(r[2]) ? "ATM withdrawal" : r[2].trim(),
      txnAt: d ? istIso(d.y, d.m, d.d) : receivedAt,
      bankBalance: balanceIn(t),
    };
  }

  return null;
}

function balanceIn(t: string): number | null {
  const r = /(?:available|avl\.?) (?:bal(?:ance)?)[^0-9]{0,40}?Rs\.?\s?([\d,]+(?:\.\d+)?)/i.exec(t);
  return r ? toAmount(r[1]) : null;
}

const CATS: [RegExp, string][] = [
  [/swiggy|zomato|instamart|blinkit|zepto|bigbasket|dmart|restaurant|cafe|food|barbeque|dominos|kfc|mcdonald|starbucks/i, "Food & groceries"],
  [/amazon|flipkart|myntra|ajio|nykaa|meesho|tata ?cliq|croma|reliance digital|ikea/i, "Shopping"],
  [/uber|ola|rapido|irctc|air ?india|indigo|vistara|akasa|makemytrip|goibibo|cleartrip|redbus|airline|airways/i, "Travel"],
  [/petrol|fuel|hpcl|bpcl|iocl|indian oil|shell|filling station/i, "Fuel"],
  [/netflix|prime|hotstar|spotify|youtube|linkedin|google|apple|microsoft|airtel|jio|vodafone|bescom|electricity|broadband|insurance|max life|lic/i, "Bills & subscriptions"],
  [/gold|jewel|bhima|tanishq|kalyan|malabar/i, "Gold & jewellery"],
  [/hospital|pharma|apollo|medplus|clinic|health/i, "Health"],
  [/atm|cash/i, "Cash"],
];

export function categorize(merchant: string | null): string {
  if (!merchant) return "Other";
  for (const [re, c] of CATS) if (re.test(merchant)) return c;
  return "Other";
}
