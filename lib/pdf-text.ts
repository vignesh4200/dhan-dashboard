// Fetches a PDF (an NSE corporate filing, e.g. a board-meeting-outcome
// document) and extracts its full text. Used as a last-resort fallback when
// NSE's auto-generated announcement summary doesn't state the dividend
// amount — the real figure only exists inside the attached PDF itself.
//
// This is meaningfully slower than a text search (downloading a multi-MB
// PDF and parsing it takes real time), so it's only attempted once, on the
// single best-guess candidate document, not tried across many PDFs.
import pdfParse from "pdf-parse";

export async function extractPdfText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const data = await pdfParse(buffer);
    return data.text || null;
  } catch {
    return null;
  }
}
