import type { Mail, Mailer } from "../types.ts";
import { UpstreamError } from "../upstream.ts";

// Live mailer backed by Trigenys Notify (generic e-mail route, contract v1):
// `POST {base}/v1/dispatch/{project}/email` with the product-scoped key in
// `x-notify-auth`. Notify owns the sender, the provider and the delivery
// policy; Studio only hands over an event. Notify rejects events older than
// five minutes, so every attempt is a fresh event: its id is derived from
// `Mail.key` (dispatch id + attempt) when present, so a retried HTTP call of
// the same attempt is deduplicated by Notify rather than sent twice.

const MAX_TTL_MS = 24 * 60 * 60 * 1000;
// A magic link is short-lived; a stale one must not be delivered at all.
const TTL_MS: Record<Mail["template"], number> = {
  "magic-link": 15 * 60 * 1000,
  alert: MAX_TTL_MS,
  "task-assigned": MAX_TTL_MS,
};

export type NotifyMailerOptions = {
  baseUrl: string;
  ingestKey: string;
  project?: string;
  fetch?: typeof fetch;
  now?: () => Date;
};

export class NotifyMailer implements Mailer {
  readonly name = "trigenys-notify-mailer";
  private readonly base: string;
  private readonly ingestKey: string;
  private readonly project: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(options: NotifyMailerOptions) {
    this.base = options.baseUrl.replace(/\/+$/, "");
    this.ingestKey = options.ingestKey;
    this.project = options.project ?? "trigenys-studio";
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  async send(mail: Mail): Promise<void> {
    const occurredAt = this.now();
    const body = {
      version: 1,
      project: this.project,
      id: await sha256Hex(`${this.project}:${mail.key ?? crypto.randomUUID()}`),
      occurredAt: occurredAt.toISOString(),
      expiresAt: new Date(occurredAt.getTime() + TTL_MS[mail.template]).toISOString(),
      recipient: mail.to,
      message: { subject: singleLine(mail.subject), html: toHtml(mail.text), text: mail.text },
    };
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}/v1/dispatch/${encodeURIComponent(this.project)}/email`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", "x-notify-auth": this.ingestKey },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new UpstreamError(this.name, `unreachable (${e instanceof Error ? e.message : String(e)})`);
    }
    // Only the status crosses this boundary: Notify's body may echo the recipient.
    if (res.status !== 202) throw new UpstreamError(this.name, `HTTP ${res.status}`, res.status);
    const payload = (await res.json().catch(() => null)) as { accepted?: unknown } | null;
    if (payload?.accepted !== true) throw new UpstreamError(this.name, "event not accepted", res.status);
  }
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Plain-text body rendered as paragraphs; URLs become links so the phone's
// mail client opens the Studio directly.
export function toHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => {
      const html = escapeHtml(block)
        .replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}">${url}</a>`)
        .replace(/\n/g, "<br>");
      return `<p>${html}</p>`;
    })
    .join("\n");
}
