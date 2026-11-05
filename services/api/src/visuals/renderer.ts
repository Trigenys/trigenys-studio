import type { BrandPalette, VisualLayout } from "../db/schema.ts";
import { toBase64 } from "./canonical.ts";

// A renderer turns a brand kit, a format and a few lines of text into bytes.
// Same input, same bytes: the output is hashed and the hash binds approvals.
// The MVP engine writes SVG by hand (adapted from the Insight OG route, no
// wasm, no fonts shipped); a PNG engine can be added behind this interface.

export type RenderInput = {
  format: { width: number; height: number; layout: VisualLayout };
  kit: { palette: BrandPalette; fontFamily: string; mentions: string };
  logo: { mime: string; bytes: Uint8Array };
  title: string;
  subtitle: string;
  variant: number;
};

export type RenderOutput = { mime: string; bytes: Uint8Array };

export interface VisualRenderer {
  readonly id: string;
  render(input: RenderInput): RenderOutput;
}

const XML_ESCAPES: Record<string, string> = { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" };
export const escapeXml = (text: string): string => text.replace(/[<>&"']/g, (ch) => XML_ESCAPES[ch] ?? ch);

// Deterministic line breaking from an average glyph width (0.55 em): the
// hashed output never depends on the fonts of the machine that displays it.
export function wrapLines(text: string, maxWidth: number, fontSize: number, maxLines: number): string[] {
  const perLine = Math.max(1, Math.floor(maxWidth / (fontSize * 0.55)));
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= perLine || !current) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  const clipped = lines.map((l) => (l.length > perLine ? `${l.slice(0, perLine - 1)}…` : l));
  if (clipped.length > maxLines) {
    const kept = clipped.slice(0, maxLines);
    const last = kept[maxLines - 1] ?? "";
    kept[maxLines - 1] = last.endsWith("…") ? last : `${last.slice(0, Math.max(1, perLine - 1))}…`;
    return kept;
  }
  return clipped;
}

// Variants rotate the roles of the palette so each one looks different while
// staying inside the approved colours.
function colours(p: BrandPalette, variant: number) {
  const schemes = [
    { bg: p.background, text: p.text, accent: p.accent ?? p.primary, band: p.primary },
    { bg: p.primary, text: p.background, accent: p.secondary, band: p.secondary },
    { bg: p.secondary, text: p.text, accent: p.primary, band: p.primary },
  ];
  return schemes[Math.max(0, variant - 1) % schemes.length] ?? schemes[0]!;
}

export const svgRenderer: VisualRenderer = {
  id: "svg@1",
  render({ format, kit, logo, title, subtitle, variant }) {
    const { width, height, layout } = format;
    const c = colours(kit.palette, variant);
    const font = escapeXml(kit.fontFamily);
    const inner = width - layout.padding * 2;
    const titleLines = wrapLines(title, inner, layout.titleSize, layout.titleMaxLines);
    const subtitleLines = subtitle ? wrapLines(subtitle, inner, layout.subtitleSize, 2) : [];
    const logoW = Math.round(layout.logoHeight * 2.5);
    const logoX = layout.logoPosition.endsWith("right") ? width - layout.padding - logoW : layout.padding;
    const logoY = layout.logoPosition.startsWith("bottom") ? height - layout.padding - layout.logoHeight : layout.padding;
    const titleStart = Math.round(height * 0.42);
    const lineH = Math.round(layout.titleSize * 1.12);
    const subStart = titleStart + titleLines.length * lineH + Math.round(layout.subtitleSize * 0.8);
    const subLineH = Math.round(layout.subtitleSize * 1.3);
    const text = (lines: string[], y: number, size: number, weight: number, lh: number, fill: string) =>
      lines
        .map((l, i) => `<text x="${layout.padding}" y="${y + i * lh}" font-family="${font}" font-size="${size}" font-weight="${weight}" fill="${fill}">${escapeXml(l)}</text>`)
        .join("");
    const mentions = kit.mentions
      ? `<text x="${layout.padding}" y="${height - layout.padding / 2}" font-family="${font}" font-size="${Math.round(layout.subtitleSize * 0.7)}" fill="${c.text}" opacity="0.7">${escapeXml(kit.mentions)}</text>`
      : "";
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
      `<rect width="${width}" height="${height}" fill="${c.bg}"/>` +
      `<rect x="0" y="${height - 12}" width="${width}" height="12" fill="${c.band}"/>` +
      `<rect x="${layout.padding}" y="${titleStart - layout.titleSize - 24}" width="96" height="8" fill="${c.accent}"/>` +
      `<image x="${logoX}" y="${logoY}" width="${logoW}" height="${layout.logoHeight}" preserveAspectRatio="xMinYMid meet" href="data:${logo.mime};base64,${toBase64(logo.bytes)}"/>` +
      text(titleLines, titleStart, layout.titleSize, 700, lineH, c.text) +
      text(subtitleLines, subStart, layout.subtitleSize, 400, subLineH, c.accent) +
      mentions +
      `</svg>`;
    return { mime: "image/svg+xml", bytes: new TextEncoder().encode(svg) };
  },
};
