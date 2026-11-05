import { describe, expect, it } from "vitest";
import { fromBase64, sha256Bytes, stableStringify, toBase64 } from "../src/visuals/canonical.ts";
import { escapeXml, svgRenderer, wrapLines } from "../src/visuals/renderer.ts";

const logo = { mime: "image/svg+xml", bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>') };
const kit = { palette: { primary: "#112233", secondary: "#445566", background: "#ffffff", text: "#000000" }, fontFamily: "Inter", mentions: "© Trigenys" };
const format = { width: 1200, height: 630, layout: { padding: 64, titleSize: 64, subtitleSize: 32, logoHeight: 56, logoPosition: "top-left" as const, titleMaxLines: 3 } };

describe("canonical", () => {
  it("stableStringify sorts keys and drops undefined", () => {
    expect(stableStringify({ b: 1, a: [{ z: undefined, y: "x" }] })).toBe('{"a":[{"y":"x"}],"b":1}');
  });
  it("base64 round-trips bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });
});

describe("svg renderer", () => {
  it("is deterministic: same input, same bytes and hash", async () => {
    const a = svgRenderer.render({ format, kit, logo, title: "Un titre", subtitle: "Sous-titre", variant: 1 });
    const b = svgRenderer.render({ format, kit, logo, title: "Un titre", subtitle: "Sous-titre", variant: 1 });
    expect(a.mime).toBe("image/svg+xml");
    expect(await sha256Bytes(a.bytes)).toBe(await sha256Bytes(b.bytes));
    const svg = new TextDecoder().decode(a.bytes);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"')).toBe(true);
    expect(svg).toContain("Un titre");
    expect(svg).toContain("data:image/svg+xml;base64,");
    expect(svg).toContain("© Trigenys");
  });

  it("changes with the variant and with the palette", async () => {
    const base = await sha256Bytes(svgRenderer.render({ format, kit, logo, title: "T", subtitle: "", variant: 1 }).bytes);
    const v2 = await sha256Bytes(svgRenderer.render({ format, kit, logo, title: "T", subtitle: "", variant: 2 }).bytes);
    const other = await sha256Bytes(svgRenderer.render({ format, kit: { ...kit, palette: { ...kit.palette, primary: "#ff0000" } }, logo, title: "T", subtitle: "", variant: 1 }).bytes);
    expect(new Set([base, v2, other]).size).toBe(3);
  });

  it("escapes markup in texts so a title cannot inject SVG", () => {
    const svg = new TextDecoder().decode(svgRenderer.render({ format, kit, logo, title: '<script>alert("x")</script>', subtitle: "", variant: 1 }).bytes);
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
    expect(escapeXml("a&b")).toBe("a&amp;b");
  });

  it("wraps and clips long titles deterministically", () => {
    const lines = wrapLines("mot ".repeat(60).trim(), 1072, 64, 3);
    expect(lines).toHaveLength(3);
    expect(lines[2]!.endsWith("…")).toBe(true);
    expect(wrapLines("court", 1072, 64, 3)).toEqual(["court"]);
  });
});
