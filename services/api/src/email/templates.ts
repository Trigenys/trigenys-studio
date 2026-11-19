import { renderBrandedEmail, renderButton, renderFacts, renderFallbackLink, renderParagraphs, renderQuote } from "./layout.ts";

// Each Studio e-mail as subject, plain text and branded HTML. The text part
// carries the same information and the link, for clients that show no HTML.

export type RenderedMail = { subject: string; text: string; html: string };

const CTA = "Ouvrir dans le Studio";

export function magicLinkEmail(url: string, recipient: string): RenderedMail {
  const subject = "Votre lien de connexion Trigenys Studio";
  return {
    subject,
    text: `Connectez-vous avec ce lien (valable 15 minutes) : ${url}`,
    html: renderBrandedEmail({
      subject,
      preheader: "Votre lien de connexion, valable 15 minutes.",
      title: "Connexion au Studio",
      bodyHtml:
        renderParagraphs("Cliquez sur le bouton pour vous connecter. Le lien est valable 15 minutes et ne sert qu'une fois.") +
        renderButton(url, "Se connecter") +
        renderFallbackLink(url),
      recipient,
      footerNote: "Vous n'avez rien demandé ? Ignorez ce message : sans clic, personne ne se connecte.",
    }),
  };
}

export type TaskAssignedInput = { title: string; product: string; dueDate: string | null; brief: string; link: string; recipient: string };

export function taskAssignedEmail(t: TaskAssignedInput): RenderedMail {
  const subject = `[Studio] Nouvelle tâche · ${t.title}`;
  const brief = t.brief.trim();
  const excerpt = brief.length > 600 ? `${brief.slice(0, 600)}…` : brief;
  const facts: [string, string][] = [["Produit", t.product]];
  if (t.dueDate) facts.push(["Échéance", t.dueDate]);
  const due = t.dueDate ? `\nÉchéance : ${t.dueDate}` : "";
  return {
    subject,
    text: `Une tâche vous a été assignée : ${t.title}\nProduit : ${t.product}${due}${excerpt ? `\n\n${excerpt}` : ""}\n\nÀ traiter dans le Studio : ${t.link}`,
    html: renderBrandedEmail({
      subject,
      preheader: `${t.product}${t.dueDate ? ` · échéance ${t.dueDate}` : ""}`,
      title: t.title,
      bodyHtml:
        renderParagraphs("Une nouvelle tâche vous a été assignée.") +
        renderFacts(facts) +
        renderQuote(excerpt) +
        renderButton(t.link, CTA) +
        renderFallbackLink(t.link),
      recipient: t.recipient,
    }),
  };
}

export type AlertInput = { priorityLabel: string; title: string; detail: string; link: string; recipient: string };

export function alertEmail(a: AlertInput): RenderedMail {
  const subject = `[Studio] ${a.priorityLabel} · ${a.title}`;
  return {
    subject,
    text: `${a.title}\n\n${a.detail}\n\nÀ traiter dans le Studio : ${a.link}`,
    html: renderBrandedEmail({
      subject,
      preheader: `Alerte ${a.priorityLabel} : ${a.title}`,
      title: a.title,
      bodyHtml:
        renderFacts([["Priorité", a.priorityLabel]]) +
        renderQuote(a.detail) +
        renderButton(a.link, CTA) +
        renderFallbackLink(a.link),
      recipient: a.recipient,
    }),
  };
}
