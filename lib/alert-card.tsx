// Renders professional, branded PNG cards for Telegram alerts — same dark
// fintech palette as the dashboard itself (app/globals.css tokens). Fonts
// are bundled in /assets/fonts and read from disk rather than fetched over
// the network at request time: no live dependency on Google Fonts, and no
// risk of hitting our own SSO-protected Vercel domain. The ₹ glyph isn't in
// standard Latin font subsets (confirmed by testing), so amounts in images
// use "Rs." — plain Telegram text messages still use the real ₹ glyph,
// since those render through Telegram's own font engine, not this one.
import { ImageResponse } from "next/og";
import { readFile } from "fs/promises";
import path from "path";

const COLORS = {
  ink: "#0D0F1A",
  panel: "#161927",
  panel2: "#1D2033",
  border: "#262A3E",
  text: "#EDEEF5",
  textMuted: "#8286A0",
  purple: "#6B5CE6",
  amber: "#F0B94F",
  gain: "#34D399",
  loss: "#F87171",
};

let fontCache: { name: string; data: Buffer; weight: 400 | 500 | 600 | 700; style: "normal" }[] | null = null;

async function loadFonts() {
  if (fontCache) return fontCache;
  const dir = path.join(process.cwd(), "assets", "fonts");
  const [interReg, interSemi, interBold, sgSemi, sgBold, monoMed, monoSemi] = await Promise.all([
    readFile(path.join(dir, "Inter-Regular.woff")),
    readFile(path.join(dir, "Inter-SemiBold.woff")),
    readFile(path.join(dir, "Inter-Bold.woff")),
    readFile(path.join(dir, "SpaceGrotesk-SemiBold.woff")),
    readFile(path.join(dir, "SpaceGrotesk-Bold.woff")),
    readFile(path.join(dir, "IBMPlexMono-Medium.woff")),
    readFile(path.join(dir, "IBMPlexMono-SemiBold.woff")),
  ]);
  fontCache = [
    { name: "Inter", data: interReg, weight: 400, style: "normal" },
    { name: "Inter", data: interSemi, weight: 600, style: "normal" },
    { name: "Inter", data: interBold, weight: 700, style: "normal" },
    { name: "Space Grotesk", data: sgSemi, weight: 600, style: "normal" },
    { name: "Space Grotesk", data: sgBold, weight: 700, style: "normal" },
    { name: "IBM Plex Mono", data: monoMed, weight: 500, style: "normal" },
    { name: "IBM Plex Mono", data: monoSemi, weight: 600, style: "normal" },
  ];
  return fontCache;
}

export const inrImg = (n: number) => "Rs. " + Math.round(Math.abs(n)).toLocaleString("en-IN");
export const signImg = (n: number) => (n >= 0 ? "+" : "−");

const W = 1200;
const H = 630;

function Brand({ eyebrow }: { eyebrow: string }) {
  return {
    type: "div",
    props: {
      style: { display: "flex", alignItems: "center", gap: 10 },
      children: [
        {
          type: "div",
          props: {
            style: {
              width: 9, height: 9, borderRadius: 999, backgroundColor: COLORS.purple, display: "flex",
            },
          },
        },
        {
          type: "div",
          props: {
            style: {
              fontFamily: "Inter", fontWeight: 600, fontSize: 15, letterSpacing: 2,
              color: COLORS.textMuted, textTransform: "uppercase",
            },
            children: "Dhan Portfolio  ·  " + eyebrow,
          },
        },
      ],
    },
  };
}

function Footer() {
  const now = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
  });
  return {
    type: "div",
    props: {
      style: { fontFamily: "Inter", fontSize: 14, color: COLORS.textMuted },
      children: now + " IST",
    },
  };
}

type Row = { label: string; value: string; color?: string };

async function render(node: any): Promise<Buffer> {
  const fonts = await loadFonts();
  const img = new ImageResponse(node, { width: W, height: H, fonts: fonts as any });
  return Buffer.from(await img.arrayBuffer());
}

// A single-stat card: used for profit-booking, gold threshold, milestone,
// and dividend-declared alerts — one accent color, one headline, one big
// number, a couple of detail rows.
export async function renderStatCard(params: {
  eyebrow: string;
  accent: string;
  icon: string;
  headline: string;
  bigValue: string;
  bigValueColor?: string;
  rows?: Row[];
  subtext?: string;
}): Promise<Buffer> {
  const { eyebrow, accent, icon, headline, bigValue, bigValueColor, rows = [], subtext } = params;

  return render({
    type: "div",
    props: {
      style: {
        width: W, height: H, display: "flex", flexDirection: "column",
        backgroundColor: COLORS.ink, fontFamily: "Inter", position: "relative",
      },
      children: [
        // left accent bar
        {
          type: "div",
          props: {
            style: { position: "absolute", left: 0, top: 0, bottom: 0, width: 10, backgroundColor: accent, display: "flex" },
          },
        },
        {
          type: "div",
          props: {
            style: { display: "flex", flexDirection: "column", flex: 1, padding: "56px 64px 44px 72px", justifyContent: "space-between" },
            children: [
              {
                type: "div",
                props: {
                  style: { display: "flex", flexDirection: "column" },
                  children: [
                    {
                      type: "div",
                      props: { style: { display: "flex", justifyContent: "space-between", alignItems: "center" }, children: [Brand({ eyebrow }), { type: "div", props: { style: { fontSize: 56, display: "flex" }, children: icon } }] },
                    },
                    {
                      type: "div",
                      props: {
                        style: { fontFamily: "Space Grotesk", fontWeight: 700, fontSize: 46, color: COLORS.text, marginTop: 36, maxWidth: 980, lineHeight: 1.15, display: "flex" },
                        children: headline,
                      },
                    },
                    {
                      type: "div",
                      props: {
                        style: { fontFamily: "IBM Plex Mono", fontWeight: 600, fontSize: 84, color: bigValueColor || COLORS.text, marginTop: 28, display: "flex" },
                        children: bigValue,
                      },
                    },
                    subtext
                      ? { type: "div", props: { style: { fontFamily: "Inter", fontSize: 20, color: COLORS.textMuted, marginTop: 10, display: "flex" }, children: subtext } }
                      : { type: "div", props: { style: { display: "none" } } },
                    rows.length > 0
                      ? {
                          type: "div",
                          props: {
                            style: { display: "flex", gap: 48, marginTop: 36 },
                            children: rows.map((r) => ({
                              type: "div",
                              props: {
                                style: { display: "flex", flexDirection: "column" },
                                children: [
                                  { type: "div", props: { style: { fontSize: 14, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 1, display: "flex" }, children: r.label } },
                                  { type: "div", props: { style: { fontFamily: "IBM Plex Mono", fontSize: 26, fontWeight: 600, color: r.color || COLORS.text, marginTop: 6, display: "flex" }, children: r.value } },
                                ],
                              },
                            })),
                          },
                        }
                      : { type: "div", props: { style: { display: "none" } } },
                  ],
                },
              },
              Footer(),
            ],
          },
        },
      ],
    },
  });
}

// The richer daily-summary card: total value hero + a row of stat tiles
// (stocks/MF/gold) + best/worst performer.
export async function renderSummaryCard(params: {
  totalCurrent: number;
  dayPnl: number;
  totalPnl: number;
  totalPnlPct: number;
  stocksCurrent: number;
  mfCurrent: number;
  goldCurrent: number;
  best?: { symbol: string; pnlPct: number };
  worst?: { symbol: string; pnlPct: number };
  dividendsThisMonth?: number;
}): Promise<Buffer> {
  const { totalCurrent, dayPnl, totalPnl, totalPnlPct, stocksCurrent, mfCurrent, goldCurrent, best, worst, dividendsThisMonth } = params;
  const dayColor = dayPnl >= 0 ? COLORS.gain : COLORS.loss;
  const pnlColor = totalPnl >= 0 ? COLORS.gain : COLORS.loss;

  const tile = (label: string, value: number, color: string) => ({
    type: "div",
    props: {
      style: {
        display: "flex", flexDirection: "column", flex: 1, backgroundColor: COLORS.panel,
        border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: "22px 26px",
      },
      children: [
        { type: "div", props: { style: { fontSize: 14, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 1, display: "flex" }, children: label } },
        { type: "div", props: { style: { fontFamily: "IBM Plex Mono", fontSize: 28, fontWeight: 600, color, marginTop: 8, display: "flex" }, children: inrImg(value) } },
      ],
    },
  });

  const perfRow: any[] = [];
  if (best) {
    perfRow.push({
      type: "div",
      props: {
        style: { display: "flex", alignItems: "center", gap: 10 },
        children: [
          { type: "div", props: { style: { fontSize: 22, display: "flex" }, children: "\u{1F3C6}" } },
          { type: "div", props: { style: { fontFamily: "Inter", fontSize: 20, color: COLORS.text, display: "flex" }, children: `${best.symbol}  ${signImg(best.pnlPct)}${Math.abs(best.pnlPct).toFixed(1)}%` } },
        ],
      },
    });
  }
  if (worst && (!best || worst.symbol !== best.symbol)) {
    perfRow.push({
      type: "div",
      props: {
        style: { display: "flex", alignItems: "center", gap: 10 },
        children: [
          { type: "div", props: { style: { fontSize: 22, display: "flex" }, children: "\u{1F4C9}" } },
          { type: "div", props: { style: { fontFamily: "Inter", fontSize: 20, color: COLORS.text, display: "flex" }, children: `${worst.symbol}  ${signImg(worst.pnlPct)}${Math.abs(worst.pnlPct).toFixed(1)}%` } },
        ],
      },
    });
  }

  return render({
    type: "div",
    props: {
      style: { width: W, height: H, display: "flex", flexDirection: "column", backgroundColor: COLORS.ink, fontFamily: "Inter", position: "relative" },
      children: [
        { type: "div", props: { style: { position: "absolute", left: 0, top: 0, bottom: 0, width: 10, backgroundColor: COLORS.purple, display: "flex" } } },
        {
          type: "div",
          props: {
            style: { display: "flex", flexDirection: "column", flex: 1, padding: "48px 64px 40px 72px", justifyContent: "space-between" },
            children: [
              {
                type: "div",
                props: {
                  style: { display: "flex", flexDirection: "column" },
                  children: [
                    {
                      type: "div",
                      props: { style: { display: "flex", justifyContent: "space-between", alignItems: "center" }, children: [Brand({ eyebrow: "Daily Summary" }), { type: "div", props: { style: { fontSize: 44, display: "flex" }, children: "\u{1F4CA}" } }] },
                    },
                    {
                      type: "div",
                      props: {
                        style: { display: "flex", alignItems: "baseline", gap: 20, marginTop: 28 },
                        children: [
                          { type: "div", props: { style: { fontFamily: "IBM Plex Mono", fontWeight: 600, fontSize: 72, color: COLORS.text, display: "flex" }, children: inrImg(totalCurrent) } },
                          { type: "div", props: { style: { fontFamily: "IBM Plex Mono", fontSize: 24, fontWeight: 600, color: dayColor, display: "flex" }, children: `${signImg(dayPnl)}${inrImg(dayPnl)} today` } },
                        ],
                      },
                    },
                    {
                      type: "div",
                      props: {
                        style: { fontFamily: "Inter", fontSize: 20, color: pnlColor, marginTop: 8, display: "flex" },
                        children: `Overall ${signImg(totalPnl)}${inrImg(totalPnl)} (${signImg(totalPnlPct)}${Math.abs(totalPnlPct).toFixed(1)}%)`,
                      },
                    },
                    {
                      type: "div",
                      props: { style: { display: "flex", gap: 18, marginTop: 34 }, children: [tile("Stocks", stocksCurrent, COLORS.text), tile("Mutual Funds", mfCurrent, COLORS.text), tile("Gold", goldCurrent, COLORS.amber)] },
                    },
                    perfRow.length > 0
                      ? { type: "div", props: { style: { display: "flex", gap: 36, marginTop: 30 }, children: perfRow } }
                      : { type: "div", props: { style: { display: "none" } } },
                    dividendsThisMonth && dividendsThisMonth > 0
                      ? { type: "div", props: { style: { fontFamily: "Inter", fontSize: 18, color: COLORS.textMuted, marginTop: 20, display: "flex" }, children: `\u{1F4B5} Dividends this month: ${inrImg(dividendsThisMonth)}` } }
                      : { type: "div", props: { style: { display: "none" } } },
                  ],
                },
              },
              Footer(),
            ],
          },
        },
      ],
    },
  });
}
