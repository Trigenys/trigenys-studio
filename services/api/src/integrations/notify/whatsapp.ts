import type { GroupMessage, GroupMessenger } from "../types.ts";
import { UpstreamError } from "../upstream.ts";

// Live group messenger backed by Trigenys Notify (generic WhatsApp route,
// contract v1): `POST {base}/v1/dispatch/{project}/whatsapp` with the
// product-scoped WhatsApp key in `x-notify-auth`. The event carries no
// destination: Notify posts it to the group declared for the project.
// Notify fingerprints the whole event, occurrence time included, and rejects
// events older than five minutes, so every attempt is a fresh event whose id
// derives from `GroupMessage.key` (dispatch id + attempt).

const TTL_MS = 24 * 60 * 60 * 1000;
// Notify accepts up to 3000 characters in an 8 KiB body; this cap keeps any
// UTF-8 text within the body limit.
const MAX_TEXT = 2000;
const MAX_LINK = 1024;
const MAX_LABEL = 80;

export type NotifyWhatsAppOptions = {
  baseUrl: string;
  ingestKey: string;
  project?: string;
  fetch?: typeof fetch;
  now?: () => Date;
};

export class NotifyWhatsApp implements GroupMessenger {
  readonly name = "trigenys-notify-whatsapp";
  private readonly base: string;
  private readonly ingestKey: string;
  private readonly project: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(options: NotifyWhatsAppOptions) {
    this.base = options.baseUrl.replace(/\/+$/, "");
    this.ingestKey = options.ingestKey;
    this.project = options.project ?? "trigenys-studio";
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  async send(message: GroupMessage): Promise<void> {
    const occurredAt = this.now();
    const body = {
      version: 1,
      project: this.project,
      id: await sha256Hex(`${this.project}:whatsapp:${message.key}`),
      occurredAt: occurredAt.toISOString(),
      expiresAt: new Date(occurredAt.getTime() + TTL_MS).toISOString(),
      message: groupPayload(message),
    };
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}/v1/dispatch/${encodeURIComponent(this.project)}/whatsapp`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", "x-notify-auth": this.ingestKey },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new UpstreamError(this.name, `unreachable (${e instanceof Error ? e.message : String(e)})`);
    }
    // Only the status and Notify's error code cross this boundary, never the body.
    if (res.status !== 202) {
      const code = await errorCode(res);
      throw new UpstreamError(this.name, `HTTP ${res.status}${code ? ` ${code}` : ""}`, res.status);
    }
    const payload = (await res.json().catch(() => null)) as { accepted?: unknown } | null;
    if (payload?.accepted !== true) throw new UpstreamError(this.name, "event not accepted", res.status);
  }
}

// Shapes the message to the contract: plain text with newlines only, an
// https link within the size limit, a single-line label only with a link.
export function groupPayload(message: GroupMessage): { text: string; link?: string; linkLabel?: string } {
  const text = truncate(cleanText(message.text), MAX_TEXT) || "(message vide)";
  const link = message.link?.trim();
  if (!link || !link.startsWith("https://") || link.length > MAX_LINK) return { text };
  const label = message.linkLabel ? truncate(singleLine(message.linkLabel), MAX_LABEL) : "";
  return label ? { text, link, linkLabel: label } : { text, link };
}

function cleanText(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").trim();
}

function singleLine(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

// Notify's error bodies are `{ error: "CODE" }`; only a well-formed code is kept.
async function errorCode(res: Response): Promise<string | null> {
  const payload = (await res.json().catch(() => null)) as { error?: unknown } | null;
  return typeof payload?.error === "string" && /^[A-Z_]{1,64}$/.test(payload.error) ? payload.error : null;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
