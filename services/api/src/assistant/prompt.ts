import type { AiAction } from "../db/schema.ts";

// Pure prompt assembly for the contextual assistant: everything the model
// sees comes from the dossier (brief, sources, latest version) plus the
// operator's instruction, and the refs of what was used are returned so the
// interaction can be audited.

export type PromptInput = {
  action: AiAction;
  channel: string;
  instruction: string;
  task: { id: string; title: string; type: string; productId: string; brief: string };
  latestVersion: { id: string; n: number; channel: string; body: string } | null;
  sources: { id: string; title: string; url: string | null; note: string }[];
};

export type Prompt = { system: string; prompt: string; contextRefs: string[] };

export const SYSTEM_PROMPT = [
  "Tu es l'assistant éditorial de Trigenys Studio.",
  "Tu rédiges en français, de façon factuelle et sobre, sans superlatifs ni emojis.",
  "Tu t'appuies uniquement sur le brief, les sources et la version fournis ; tu n'inventes ni chiffre ni citation.",
  "Tu réponds avec le texte final seulement, sans préambule ni commentaire.",
].join(" ");

const INSTRUCTIONS: Record<AiAction, (channel: string) => string> = {
  propose: (channel) => `Propose une première version du contenu pour le canal « ${channel} », à partir du brief et des sources.`,
  fix: (channel) =>
    `Corrige la version actuelle pour le canal « ${channel} » : orthographe, grammaire, clarté. Conserve le fond, la structure et le ton.`,
  summarize: (channel) => `Synthétise la version actuelle en un texte court adapté au canal « ${channel} », en gardant l'essentiel.`,
  adapt: (channel) => `Décline la version actuelle pour le canal « ${channel} », en respectant ses usages (longueur, ton, format).`,
};

// Actions that work on an existing text need one.
export const NEEDS_VERSION: ReadonlySet<AiAction> = new Set(["fix", "summarize", "adapt"]);

export function buildPrompt(input: PromptInput): Prompt {
  const parts: string[] = [];
  const refs: string[] = [`task:${input.task.id}`];
  parts.push(`# Tâche\nProduit : ${input.task.productId}\nType : ${input.task.type}\nTitre : ${input.task.title}`);
  if (input.task.brief.trim()) parts.push(`# Brief\n${input.task.brief.trim()}`);
  if (input.sources.length) {
    parts.push(
      "# Sources\n" +
        input.sources.map((s) => `- ${s.title}${s.url ? ` (${s.url})` : ""}${s.note.trim() ? ` — ${s.note.trim()}` : ""}`).join("\n"),
    );
    refs.push(...input.sources.map((s) => `source:${s.id}`));
  }
  if (input.latestVersion) {
    parts.push(`# Version actuelle (v${input.latestVersion.n}, ${input.latestVersion.channel})\n${input.latestVersion.body}`);
    refs.push(`version:${input.latestVersion.id}`);
  }
  parts.push(`# Consigne\n${INSTRUCTIONS[input.action](input.channel)}`);
  if (input.instruction.trim()) parts.push(`# Précision de l'opérateur\n${input.instruction.trim()}`);
  return { system: SYSTEM_PROMPT, prompt: parts.join("\n\n"), contextRefs: refs };
}
