// Branded HTML layout shared by every Studio e-mail (adapted from the
// RoadmapMentor layout). Inline styles and tables only: mail clients strip
// <style> blocks and ignore most modern CSS. Every caller value is escaped
// here; `bodyHtml` is the only trusted fragment and comes from the renderers
// below.

const BRAND = {
  accent: "#7f2044",
  ink: "#1a1219",
  muted: "#6b5d66",
  line: "#eadfe4",
  page: "#f6f1f3",
  card: "#ffffff",
  soft: "#f8eef2",
} as const;

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Plain text to escaped paragraphs; line breaks are kept.
export function renderParagraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${BRAND.ink};">${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export function renderButton(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;"><tr><td style="border-radius:10px;background:${BRAND.accent};"><a href="${escapeHtml(href)}" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">${escapeHtml(label)}</a></td></tr></table>`;
}

// Label / value rows (product, due date…), rendered as a soft card.
export function renderFacts(facts: ReadonlyArray<readonly [label: string, value: string]>): string {
  if (facts.length === 0) return "";
  const rows = facts
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 0;font-size:13px;color:${BRAND.muted};width:110px;vertical-align:top;">${escapeHtml(label)}</td><td style="padding:6px 0;font-size:14px;font-weight:600;color:${BRAND.ink};">${escapeHtml(value)}</td></tr>`,
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:4px 0 18px;background:${BRAND.soft};border-radius:12px;"><tr><td style="padding:12px 18px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${rows}</table></td></tr></table>`;
}

// Quoted excerpt (a brief, an alert detail).
export function renderQuote(text: string): string {
  if (!text.trim()) return "";
  return `<div style="margin:0 0 18px;padding:12px 16px;border-left:3px solid ${BRAND.accent};background:#fbf7f9;font-size:14px;line-height:1.6;color:${BRAND.ink};">${escapeHtml(text.trim()).replace(/\n/g, "<br>")}</div>`;
}

export function renderFallbackLink(href: string): string {
  return `<p style="margin:0 0 6px;font-size:12px;line-height:1.5;color:${BRAND.muted};">Si le bouton ne fonctionne pas, copiez ce lien :</p><p style="margin:0 0 18px;font-size:12px;line-height:1.5;word-break:break-all;"><a href="${escapeHtml(href)}" style="color:${BRAND.accent};">${escapeHtml(href)}</a></p>`;
}

export type BrandedEmail = {
  subject: string;
  // Inbox preview line, hidden in the message itself.
  preheader: string;
  title: string;
  bodyHtml: string;
  recipient?: string;
  footerNote?: string;
};

export function renderBrandedEmail(e: BrandedEmail): string {
  const footer = [
    e.footerNote ? escapeHtml(e.footerNote) : "",
    e.recipient ? `Message envoyé à ${escapeHtml(e.recipient)}.` : "",
    `© ${new Date().getUTCFullYear()} Trigenys`,
  ]
    .filter(Boolean)
    .join("<br>");
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(e.subject)}</title></head>
<body style="margin:0;padding:0;background:${BRAND.page};font-family:${FONT};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(e.preheader)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${BRAND.page};"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:540px;background:${BRAND.card};border:1px solid ${BRAND.line};border-radius:18px;">
<tr><td style="padding:30px 30px 8px;">
<span style="display:inline-block;padding:7px 12px;border-radius:10px;background:${BRAND.ink};font-size:13px;font-weight:700;letter-spacing:.2px;color:#ffffff;">Trigenys <span style="color:#e7a2b6;">Studio</span></span>
<h1 style="margin:22px 0 14px;font-size:21px;line-height:1.3;font-weight:800;color:${BRAND.ink};">${escapeHtml(e.title)}</h1>
${e.bodyHtml}
</td></tr>
<tr><td style="padding:0 30px 26px;"><div style="border-top:1px solid ${BRAND.line};padding-top:14px;font-size:12px;line-height:1.6;color:${BRAND.muted};">${footer}</div></td></tr>
</table>
</td></tr></table>
</body></html>`;
}
