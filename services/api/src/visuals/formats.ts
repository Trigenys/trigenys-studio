import { z } from "@hono/zod-openapi";
import { and, eq } from "drizzle-orm";
import type { Db, Tx } from "../db/client.ts";
import { visualFormat } from "../db/schema.ts";

export type VisualFormatRow = typeof visualFormat.$inferSelect;

export const VisualLayoutSchema = z
  .object({
    padding: z.number().int().min(0).max(400),
    titleSize: z.number().int().min(8).max(400),
    subtitleSize: z.number().int().min(8).max(300),
    logoHeight: z.number().int().min(8).max(600),
    logoPosition: z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]),
    titleMaxLines: z.number().int().min(1).max(8),
  })
  .openapi("VisualLayout");

export const VisualFormatSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
    label: z.string().min(1).max(80),
    width: z.number().int().min(64).max(4096),
    height: z.number().int().min(64).max(4096),
    channel: z.string().max(40).nullable(),
    layout: VisualLayoutSchema,
    active: z.boolean(),
    updatedAt: z.string(),
  })
  .openapi("VisualFormat");

export const UpsertVisualFormatSchema = VisualFormatSchema.omit({ id: true, updatedAt: true })
  .partial({ active: true, channel: true })
  .openapi("UpsertVisualFormat");

export const serialiseFormat = (f: VisualFormatRow) => ({ ...f, createdAt: undefined, updatedAt: f.updatedAt.toISOString() });

export async function activeFormat(db: Db | Tx, id: string): Promise<VisualFormatRow | null> {
  const [row] = await db
    .select()
    .from(visualFormat)
    .where(and(eq(visualFormat.id, id), eq(visualFormat.active, true)));
  return row ?? null;
}
