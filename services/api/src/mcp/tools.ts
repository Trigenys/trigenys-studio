import { z } from "zod";
import {
  ALERT_PRIORITIES,
  ALERT_STATES,
  APPROVAL_DECISIONS,
  IMPORT_ORIGINS,
  IMPORT_STATUSES,
  TASK_STATES,
} from "../db/schema.ts";

// One MCP tool = one REST route replayed in-process. The table is declarative:
// nothing here touches the database or the policies; RBAC, audit and
// idempotency are enforced by the route the tool maps to.

export type RouteCall = {
  method: "GET" | "POST" | "PATCH";
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  idempotencyKey?: string;
};

export type ToolAnnotations = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
};

export type ToolSpec<S extends z.ZodRawShape = z.ZodRawShape> = {
  name: string;
  description: string;
  input: S;
  annotations: ToolAnnotations;
  toRequest: (args: z.infer<z.ZodObject<S>>) => RouteCall;
};

const READ: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };
const WRITE: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false };
const WRITE_IDEMPOTENT: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true };

const iso = z.iso.datetime({ offset: true });
const idempotencyKey = z
  .string()
  .min(1)
  .max(200)
  .optional()
  .describe("Replay key: the same key with the same arguments returns the first result instead of acting twice");

function define<S extends z.ZodRawShape>(spec: ToolSpec<S>): ToolSpec {
  return spec as unknown as ToolSpec;
}

export const TOOLS: ReadonlyArray<ToolSpec> = [
  define({
    name: "list_imports",
    description: "Entrées reçues du CMS Insight et du radar Editorial OS, filtrables par origine et statut.",
    input: {
      origin: z.enum(IMPORT_ORIGINS).optional(),
      status: z.enum(IMPORT_STATUSES).optional(),
      limit: z.number().int().min(1).max(200).optional(),
    },
    annotations: READ,
    toRequest: (a) => ({ method: "GET", path: "/imports", query: a }),
  }),
  define({
    name: "sync_imports",
    description: "Synchronise les entrées depuis les sources amont (CMS, radar). Requiert content.write.",
    input: {
      origin: z.enum([...IMPORT_ORIGINS, "all"]).optional(),
      limit: z.number().int().min(1).max(100).optional(),
      since: iso.optional().describe("Only items updated upstream after this instant"),
    },
    annotations: WRITE_IDEMPOTENT,
    toRequest: (a) => ({ method: "POST", path: "/imports/sync", body: a }),
  }),
  define({
    name: "create_task_from_import",
    description: "Crée une tâche de production à partir d'une entrée et la marque comme liée.",
    input: {
      importId: z.string().min(1),
      productId: z.string().min(1),
      type: z.string().min(1).max(40).optional(),
      title: z.string().min(1).max(200).optional(),
      assigneeId: z.string().nullable().optional(),
      idempotencyKey,
    },
    annotations: WRITE,
    toRequest: ({ importId, idempotencyKey: key, ...body }) => ({
      method: "POST",
      path: `/imports/${encodeURIComponent(importId)}/task`,
      body,
      idempotencyKey: key,
    }),
  }),
  define({
    name: "ignore_import",
    description: "Écarte une entrée sans créer de tâche.",
    input: { importId: z.string().min(1) },
    annotations: WRITE_IDEMPOTENT,
    toRequest: ({ importId }) => ({ method: "POST", path: `/imports/${encodeURIComponent(importId)}/ignore` }),
  }),
  define({
    name: "list_products",
    description: "Produits (marques, offres) visibles par l'utilisateur : id à passer en productId.",
    input: {},
    annotations: READ,
    toRequest: () => ({ method: "GET", path: "/products" }),
  }),
  define({
    name: "list_tasks",
    description: 'Tâches de production visibles par l\'utilisateur. assigneeId="me" sélectionne ses propres tâches.',
    input: {
      productId: z.string().optional(),
      state: z.enum(TASK_STATES).optional(),
      assigneeId: z.string().optional(),
      dueBefore: iso.optional(),
    },
    annotations: READ,
    toRequest: (a) => ({ method: "GET", path: "/tasks", query: a }),
  }),
  define({
    name: "list_assignees",
    description:
      "Personnes à qui confier une tâche de ce produit (rôle sur le produit ou global) : id à passer en assigneeId.",
    input: { productId: z.string().min(1) },
    annotations: READ,
    toRequest: ({ productId }) => ({ method: "GET", path: `/products/${encodeURIComponent(productId)}/assignees` }),
  }),
  define({
    name: "create_task",
    description:
      "Crée une tâche de production (brief libre) et peut la confier directement à quelqu'un : la personne assignée reçoit une notification. Requiert content.write.",
    input: {
      productId: z.string().min(1),
      type: z.string().min(1).max(40).describe("post, article, visuel, newsletter…"),
      title: z.string().min(1).max(200),
      brief: z.string().max(20_000).optional(),
      priority: z.number().int().min(0).max(3).optional().describe("0 = normale … 3 = urgente"),
      dueAt: iso.nullable().optional(),
      assigneeId: z.string().nullable().optional().describe("id issu de list_assignees"),
      idempotencyKey,
    },
    annotations: WRITE,
    toRequest: ({ idempotencyKey: key, ...body }) => ({ method: "POST", path: "/tasks", body, idempotencyKey: key }),
  }),
  define({
    name: "assign_task",
    description:
      "Confie une tâche existante à quelqu'un (ou la désassigne avec null) ; la nouvelle personne est notifiée. version = celle lue par get_task : un conflit 409 signifie que la tâche a changé entre-temps.",
    input: {
      taskId: z.string().min(1),
      assigneeId: z.string().nullable().describe("id issu de list_assignees, null pour désassigner"),
      version: z.number().int().min(1),
    },
    annotations: WRITE_IDEMPOTENT,
    toRequest: ({ taskId, ...body }) => ({ method: "PATCH", path: `/tasks/${encodeURIComponent(taskId)}`, body }),
  }),
  define({
    name: "get_task",
    description: "Détail d'une tâche : état, version (pour update_task et assign_task), dernier texte enregistré (latestVersion), transitions autorisées.",
    input: { taskId: z.string().min(1) },
    annotations: READ,
    toRequest: ({ taskId }) => ({ method: "GET", path: `/tasks/${encodeURIComponent(taskId)}` }),
  }),
  define({
    name: "update_task",
    description:
      "Modifie le cadrage d'une tâche (titre, brief, type, priorité, échéance). version = celle lue par get_task : un conflit 409 signifie que la tâche a changé entre-temps.",
    input: {
      taskId: z.string().min(1),
      version: z.number().int().min(1),
      type: z.string().min(1).max(40).optional(),
      title: z.string().min(1).max(200).optional(),
      brief: z.string().max(20_000).optional(),
      priority: z.number().int().min(0).max(3).optional(),
      dueAt: iso.nullable().optional(),
    },
    annotations: WRITE_IDEMPOTENT,
    toRequest: ({ taskId, ...body }) => ({ method: "PATCH", path: `/tasks/${encodeURIComponent(taskId)}`, body }),
  }),
  define({
    name: "save_content",
    description:
      "Enregistre le texte final d'une tâche pour un canal (nouvelle version de contenu ; l'historique est conservé). Invalide une approbation en cours. Requiert content.write.",
    input: {
      taskId: z.string().min(1),
      channel: z.string().min(1).max(40).describe("linkedin, facebook, instagram, blog, newsletter…"),
      body: z.string().min(1).max(100_000),
      aiAssisted: z.boolean().optional().describe("true si le texte a été rédigé avec une IA"),
      idempotencyKey,
    },
    annotations: WRITE,
    toRequest: ({ taskId, idempotencyKey: key, ...body }) => ({
      method: "POST",
      path: `/tasks/${encodeURIComponent(taskId)}/versions`,
      body,
      idempotencyKey: key,
    }),
  }),
  define({
    name: "list_visual_formats",
    description: "Formats de visuels disponibles (tailles, mises en page) : id à passer en formatId de render_visual.",
    input: {},
    annotations: READ,
    toRequest: () => ({ method: "GET", path: "/visual-formats" }),
  }),
  define({
    name: "render_visual",
    description:
      "Génère et attache un visuel à la tâche avec le kit de marque approuvé du produit. Invalide une approbation en cours. Requiert content.write.",
    input: {
      taskId: z.string().min(1),
      formatId: z.string().min(1).max(40).describe("id issu de list_visual_formats"),
      title: z.string().max(200).optional().describe("Par défaut : le titre de la tâche"),
      subtitle: z.string().max(300).optional(),
      brief: z.string().max(2_000).optional(),
      idempotencyKey,
    },
    annotations: WRITE,
    toRequest: ({ taskId, idempotencyKey: key, ...body }) => ({
      method: "POST",
      path: `/tasks/${encodeURIComponent(taskId)}/visuals`,
      body,
      idempotencyKey: key,
    }),
  }),
  define({
    name: "move_task",
    description:
      "Fait avancer une tâche dans le flux : preparing → reviewing (soumettre en relecture) → visuals → awaiting_approval (demander l'approbation). Les états permis sont dans allowedTransitions de get_task.",
    input: {
      taskId: z.string().min(1),
      to: z.enum(TASK_STATES),
      reason: z.string().max(2_000).nullable().optional(),
      idempotencyKey,
    },
    annotations: WRITE,
    toRequest: ({ taskId, idempotencyKey: key, ...body }) => ({
      method: "POST",
      path: `/tasks/${encodeURIComponent(taskId)}/transitions`,
      body,
      idempotencyKey: key,
    }),
  }),
  define({
    name: "add_comment",
    description: "Ajoute un commentaire à une tâche (consignes, retours de relecture).",
    input: { taskId: z.string().min(1), body: z.string().min(1).max(10_000), idempotencyKey },
    annotations: WRITE,
    toRequest: ({ taskId, idempotencyKey: key, ...body }) => ({
      method: "POST",
      path: `/tasks/${encodeURIComponent(taskId)}/comments`,
      body,
      idempotencyKey: key,
    }),
  }),
  define({
    name: "decide_approval",
    description:
      "Approuve ou rejette la version de contenu en attente. Requiert content.review ; l'auteur ne peut pas s'auto-approuver.",
    input: {
      taskId: z.string().min(1),
      decision: z.enum(APPROVAL_DECISIONS),
      comment: z.string().max(5_000).nullable().optional(),
      idempotencyKey,
    },
    annotations: WRITE,
    toRequest: ({ taskId, idempotencyKey: key, ...body }) => ({
      method: "POST",
      path: `/tasks/${encodeURIComponent(taskId)}/approvals`,
      body,
      idempotencyKey: key,
    }),
  }),
  define({
    name: "list_social_accounts",
    description: "Comptes sociaux configurés, filtrables par produit et canal.",
    input: { productId: z.string().optional(), channel: z.string().optional() },
    annotations: READ,
    toRequest: (a) => ({ method: "GET", path: "/social-accounts", query: a }),
  }),
  define({
    name: "check_publish_readiness",
    description: "Vérifie si une tâche peut être programmée : état, approbation, compte, permission, fenêtre.",
    input: { taskId: z.string().min(1), socialAccountId: z.uuid().optional(), scheduledAt: iso.optional() },
    annotations: READ,
    toRequest: ({ taskId, ...query }) => ({
      method: "GET",
      path: `/tasks/${encodeURIComponent(taskId)}/publish-readiness`,
      query,
    }),
  }),
  define({
    name: "schedule_task",
    description: "Programme la publication d'une tâche approuvée sur un compte social. Requiert content.publish.",
    input: { taskId: z.string().min(1), socialAccountId: z.uuid(), scheduledAt: iso, idempotencyKey },
    annotations: WRITE,
    toRequest: ({ taskId, idempotencyKey: key, ...body }) => ({
      method: "POST",
      path: `/tasks/${encodeURIComponent(taskId)}/deliveries`,
      body,
      idempotencyKey: key,
    }),
  }),
  define({
    name: "list_alerts",
    description: 'Alertes du cockpit. state="active" (défaut) regroupe open et acknowledged.',
    input: {
      state: z.enum(["active", ...ALERT_STATES]).optional(),
      priority: z.enum(ALERT_PRIORITIES).optional(),
      productId: z.string().min(1).optional(),
      limit: z.number().int().min(1).max(200).optional(),
    },
    annotations: READ,
    toRequest: (a) => ({ method: "GET", path: "/alerts", query: a }),
  }),
  define({
    name: "acknowledge_alert",
    description: "Marque une alerte comme prise en charge.",
    input: { alertId: z.string().min(1) },
    annotations: WRITE_IDEMPOTENT,
    toRequest: ({ alertId }) => ({ method: "POST", path: `/alerts/${encodeURIComponent(alertId)}/acknowledge` }),
  }),
  define({
    name: "get_editorial_report",
    description: "Rapport éditorial mensuel (publications, objectifs, métriques).",
    input: {
      month: z
        .string()
        .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "YYYY-MM")
        .optional(),
      productId: z.string().optional(),
    },
    annotations: READ,
    toRequest: (a) => ({ method: "GET", path: "/reports/editorial", query: a }),
  }),
];
