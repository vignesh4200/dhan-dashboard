import { Fragment, ReactNode } from "react";

// Small Markdown renderer for Analyst Desk memos: headings, paragraphs,
// bullet/numbered lists, tables, **bold**, *italic*, `code` and [links](url).
// Builds React elements directly, so model output is never injected as HTML.

function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const key = `${keyPrefix}-${i++}`;
    if (t.startsWith("**")) out.push(<b key={key}>{t.slice(2, -2)}</b>);
    else if (t.startsWith("`")) out.push(<code key={key}>{t.slice(1, -1)}</code>);
    else if (t.startsWith("[")) {
      const label = t.slice(1, t.indexOf("]"));
      out.push(
        <a key={key} href={m[2]} target="_blank" rel="noreferrer" style={{ color: "var(--gold)" }}>
          {label}
        </a>
      );
    } else out.push(<i key={key}>{t.slice(1, -1)}</i>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

export default function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;

  while (i < lines.length) {
    const line = lines[i];
    const key = `b${k++}`;

    if (!line.trim()) {
      i++;
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const size = level === 1 ? 19 : level === 2 ? 15.5 : 13.5;
      blocks.push(
        <div
          key={key}
          style={{
            fontFamily: "var(--font-display)",
            fontSize: size,
            fontWeight: 600,
            margin: level === 1 ? "0 0 8px" : "18px 0 8px",
            color: "var(--text)",
          }}
        >
          {inline(heading[2], key)}
        </div>
      );
      i++;
      continue;
    }

    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
      blocks.push(
        <div key={key} style={{ overflowX: "auto", margin: "8px 0 12px" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: "60%" }}>
            <thead>
              <tr>
                {head.map((h, j) => (
                  <th
                    key={j}
                    style={{ textAlign: j === 0 ? "left" : "right", padding: "6px 10px", color: "var(--text-muted)", fontSize: 11.5, borderBottom: "1px solid var(--border-strong)" }}
                  >
                    {inline(h, `${key}h${j}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} style={{ borderTop: "1px solid var(--border)" }}>
                  {r.map((c, j) => (
                    <td key={j} style={{ textAlign: j === 0 ? "left" : "right", padding: "6px 10px", fontFamily: j === 0 ? undefined : "var(--font-mono)" }}>
                      {inline(c, `${key}r${ri}c${j}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ""));
        i++;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={key} style={{ margin: "4px 0 10px", paddingLeft: 20, lineHeight: 1.6 }}>
          {items.map((it, j) => (
            <li key={j}>{inline(it, `${key}l${j}`)}</li>
          ))}
        </List>
      );
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !/^\s*\|/.test(lines[i]) &&
      !/^\s*([-*]|\d+\.)\s+/.test(lines[i])
    ) {
      para.push(lines[i++]);
    }
    blocks.push(
      <p key={key} style={{ margin: "0 0 10px", lineHeight: 1.65 }}>
        {para.map((p, j) => (
          <Fragment key={j}>
            {j > 0 && <br />}
            {inline(p, `${key}p${j}`)}
          </Fragment>
        ))}
      </p>
    );
  }

  return <div style={{ fontSize: 13, color: "var(--text)" }}>{blocks}</div>;
}
