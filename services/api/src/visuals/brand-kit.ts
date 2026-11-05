import { and, eq } from "drizzle-orm";
import type { Db, Tx } from "../db/client.ts";
import { brandKit, type BrandPalette } from "../db/schema.ts";
import type { MediaStore } from "../integrations/types.ts";
import { ProblemError } from "../problem.ts";
import { sha256Bytes, sha256Text, stableStringify } from "./canonical.ts";

export type BrandKitRow = typeof brandKit.$inferSelect;

export const LOGO_MIMES = ["image/svg+xml", "image/png"] as const;
export const LOGO_MAX_BYTES = 256 * 1024;

// The kit hash names exactly what a render depends on: palette, font, texts
// and the logo bytes (through their hash). Same description, same hash.
export const kitHashOf = (kit: { palette: BrandPalette; fontFamily: string; defaultTitle: string | null; mentions: string; logoHash: string }): Promise<string> =>
  sha256Text(stableStringify({ palette: kit.palette, fontFamily: kit.fontFamily, defaultTitle: kit.defaultTitle, mentions: kit.mentions, logoHash: kit.logoHash }));

export const logoKeyOf = (logoHash: string, mime: string) => `logos/sha256/${logoHash}.${mime === "image/png" ? "png" : "svg"}`;

export async function approvedKitOf(db: Db | Tx, productId: string): Promise<BrandKitRow | null> {
  const [row] = await db
    .select()
    .from(brandKit)
    .where(and(eq(brandKit.productId, productId), eq(brandKit.status, "approved")));
  return row ?? null;
}

// Reads the logo back and checks it is still the bytes the kit was hashed
// with: a render must never silently use something else than what was approved.
export async function loadLogoVerified(media: MediaStore, kit: BrandKitRow): Promise<{ mime: string; bytes: Uint8Array }> {
  const object = await media.get(kit.logoKey);
  if (!object) throw new ProblemError(409, "Brand kit logo unavailable", { detail: `Logo of kit "${kit.name}" is missing from the media store` });
  if ((await sha256Bytes(object.bytes)) !== kit.logoHash) {
    throw new ProblemError(409, "Brand kit logo integrity", { detail: `Logo of kit "${kit.name}" no longer matches its hash` });
  }
  return { mime: kit.logoMime, bytes: object.bytes };
}
