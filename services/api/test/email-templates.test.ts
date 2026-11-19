import { describe, expect, it } from "vitest";
import { alertEmail, magicLinkEmail, taskAssignedEmail } from "../src/email/templates.ts";
import { escapeHtml } from "../src/email/layout.ts";
import { NotifyMailer } from "../src/integrations/notify/mailer.ts";

// Notify rejects an HTML part over 49 152 characters.
const NOTIFY_HTML_LIMIT = 49_152;

describe("branded e-mail templates", () => {
  it("escapes every caller value, including attributes", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
    const mail = taskAssignedEmail({
      title: `<script>alert("x")</script>`,
      product: "Trigenys Insight",
      dueDate: "2026-12-01",
      brief: "Brief <b>gras</b> & \"citations\"",
      link: `https://studio.example/tasks/1?a=1&b="><img src=x>`,
      recipient: "tiffany@example.com",
    });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).not.toContain("<b>gras</b>");
    expect(mail.html).not.toContain(`"><img`);
    expect(mail.html).toContain('href="https://studio.example/tasks/1?a=1&amp;b=&quot;&gt;&lt;img src=x&gt;"');
  });

  it("keeps the plain-text part complete for clients without HTML", () => {
    const mail = taskAssignedEmail({
      title: "Post LinkedIn",
      product: "Trigenys Insight",
      dueDate: "2026-12-01",
      brief: "Trois angles.",
      link: "https://studio.example/tasks/1",
      recipient: "tiffany@example.com",
    });
    expect(mail.subject).toBe("[Studio] Nouvelle tâche · Post LinkedIn");
    expect(mail.text).toBe(
      "Une tâche vous a été assignée : Post LinkedIn\nProduit : Trigenys Insight\nÉchéance : 2026-12-01\n\nTrois angles.\n\nÀ traiter dans le Studio : https://studio.example/tasks/1",
    );
    expect(mail.html).toContain("Trigenys <span");
    expect(mail.html).toContain('href="https://studio.example/tasks/1"');
    expect(mail.html).toContain("Message envoyé à tiffany@example.com.");
  });

  it("stays under the Notify HTML limit with the longest brief", () => {
    const mail = taskAssignedEmail({
      title: "t".repeat(200),
      product: "p".repeat(120),
      dueDate: null,
      brief: "&<".repeat(5000),
      link: "https://studio.example/tasks/1",
      recipient: "a@b.co",
    });
    expect(mail.text).not.toContain("Échéance");
    expect(mail.html.length).toBeLessThan(NOTIFY_HTML_LIMIT);
  });

  it("renders the magic link and the alert with a button and a fallback link", () => {
    const login = magicLinkEmail("https://studio.example/api/auth/magic-link/verify?token=t", "jennifer@exemple.com");
    expect(login.text).toBe("Connectez-vous avec ce lien (valable 15 minutes) : https://studio.example/api/auth/magic-link/verify?token=t");
    expect(login.html.match(/magic-link\/verify\?token=t/g)).toHaveLength(3);

    const alert = alertEmail({ priorityLabel: "Haute", title: "Publication échouée", detail: "Buffer a refusé.", link: "https://s/tasks/1#publication", recipient: "a@b.co" });
    expect(alert.subject).toBe("[Studio] Haute · Publication échouée");
    expect(alert.text).toContain("À traiter dans le Studio : https://s/tasks/1#publication");
    expect(alert.html).toContain("Buffer a refusé.");
  });

  it("is forwarded as is by the Notify adapter, which renders text only as a fallback", async () => {
    const bodies: { message: { html: string } }[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ accepted: true }), { status: 202 });
    }) as typeof fetch;
    const mailer = new NotifyMailer({ baseUrl: "https://n", ingestKey: "k", fetch: fetchImpl });
    const login = magicLinkEmail("https://s/verify?token=t", "a@b.co");
    await mailer.send({ to: "a@b.co", template: "magic-link", ...login });
    await mailer.send({ to: "a@b.co", template: "magic-link", subject: "s", text: "plain" });
    expect(bodies[0]!.message.html).toBe(login.html);
    expect(bodies[1]!.message.html).toBe("<p>plain</p>");
  });
});
