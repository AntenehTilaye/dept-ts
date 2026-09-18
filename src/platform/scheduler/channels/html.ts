// Minimal HTML wrapper for plain-text mail bodies (no React in the worker): paragraphs from
// blank-line separated text, URLs turned into links, everything escaped.

function escapeHtml(s: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return s.replace(/[&<>"']/g, (c) => map[c]!);
}

function linkify(escaped: string): string {
  return escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    (url) => `<a href="${url}" style="color:#1d4ed8">${url}</a>`,
  );
}

export function wrapHtml(title: string, text: string, actionUrl?: string | null): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="margin:0 0 12px 0;white-space:pre-line">${linkify(escapeHtml(p.trim()))}</p>`,
    )
    .join("");
  const button = actionUrl
    ? `<p style="margin:16px 0"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:10px 16px;background:#1d4ed8;color:#fff;text-decoration:none;border-radius:6px">Open</a></p>`
    : "";
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f7f9;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#111827">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:24px">
<h1 style="font-size:18px;margin:0 0 16px 0">${escapeHtml(title)}</h1>${paragraphs}${button}
<p style="font-size:12px;color:#6b7280;margin-top:24px">DeptTS · Department Management Tool Suite</p></div></body></html>`;
}
