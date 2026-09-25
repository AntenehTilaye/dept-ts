import type { ReportData } from "./registry";

// The printed page. It is written as a string rather than rendered through React because the
// worker renders it in a browser with no application around it, and because a report's layout is
// a stylesheet and a table — the one place in this codebase where plain HTML is the simpler
// answer. Everything interpolated goes through `escape`.

export const PRINT_CSS = `
  @page { size: A4; margin: 15mm; }
  * { box-sizing: border-box; }
  body {
    font-family: ui-sans-serif, system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #111827;
    font-size: 11pt;
    line-height: 1.45;
    margin: 0;
  }
  header { border-bottom: 2px solid #111827; padding-bottom: 8px; margin-bottom: 16px; }
  h1 { font-size: 18pt; margin: 0 0 2px; }
  .subtitle { color: #4b5563; font-size: 10pt; margin: 0; }
  .stats { display: flex; flex-wrap: wrap; gap: 12px; margin: 0 0 16px; padding: 0; list-style: none; }
  .stats li { border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 12px; min-width: 120px; }
  .stats .label { display: block; color: #6b7280; font-size: 8pt; text-transform: uppercase; letter-spacing: .04em; }
  .stats .value { font-size: 15pt; font-weight: 600; font-variant-numeric: tabular-nums; }
  section { margin-bottom: 18px; break-inside: avoid-page; }
  h2 { font-size: 12pt; margin: 0 0 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  thead { display: table-header-group; }
  th, td { border-bottom: 1px solid #e5e7eb; padding: 5px 6px; text-align: left; vertical-align: top; }
  th { background: #f9fafb; font-weight: 600; }
  td.number { text-align: right; font-variant-numeric: tabular-nums; }
  tr { break-inside: avoid; }
  .empty { color: #6b7280; font-style: italic; }
  footer { margin-top: 20px; border-top: 1px solid #e5e7eb; padding-top: 6px; color: #6b7280; font-size: 8pt; }
`;

export function escape(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** The whole report as one self-contained document: no scripts, no external requests. */
export function renderHtml(data: ReportData): string {
  const stats = data.stats?.length
    ? `<ul class="stats">${data.stats
        .map(
          (s) =>
            `<li><span class="label">${escape(s.label)}</span><span class="value">${escape(s.value)}</span></li>`,
        )
        .join("")}</ul>`
    : "";

  const tables = data.tables
    .map((table) => {
      const head = table.columns.map((c) => `<th>${escape(c.label)}</th>`).join("");
      const body = table.rows.length
        ? table.rows
            .map(
              (row) =>
                `<tr>${table.columns
                  .map(
                    (c) =>
                      `<td${c.type === "number" ? ' class="number"' : ""}>${escape(cell(row[c.key]))}</td>`,
                  )
                  .join("")}</tr>`,
            )
            .join("")
        : `<tr><td class="empty" colspan="${table.columns.length}">Nothing to show</td></tr>`;
      return `<section><h2>${escape(table.title)}</h2><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></section>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escape(data.title)}</title><style>${PRINT_CSS}</style></head>
<body>
<header>
  <h1>${escape(data.title)}</h1>
  <p class="subtitle">${escape([data.departmentName, data.subtitle].filter(Boolean).join(" · "))}</p>
</header>
${stats}
${tables}
<footer>Generated ${escape(data.generatedAt.toISOString().slice(0, 16).replace("T", " "))} · DeptTS</footer>
</body></html>`;
}

export function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}
