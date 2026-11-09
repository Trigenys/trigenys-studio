# ADR 0013 — Assignation de tâches notifiée via Trigenys Notify

Statut : accepté · Date : 2026-11-09 · Issue : — (demande directe)

## Contexte

Une prestataire (communication, marketing) reçoit son travail du studio. Le commanditaire veut
charger ces tâches depuis un assistant (MCP) ou l'API, et que la prestataire soit prévenue sur
son téléphone. Jusqu'ici : `assigneeId` acceptait n'importe quelle chaîne (une valeur inconnue
finissait en 500 sur la clé étrangère), aucune notification ne partait à l'assignation, et il
n'existait aucun adaptateur e-mail réel (`INTEGRATION_EMAIL_MODE=live` levait une erreur).
Trigenys Notify (Worker Cloudflare, dépôt `Trigenys/trigenys-notify`) expose déjà une route
e-mail générique par projet ; WhatsApp n'y est ouvert qu'à des routes propres à chaque produit
vers des groupes approuvés.

## Décision

- **Assignation validée** : l'assigné doit avoir un rôle sur le produit ou un rôle global,
  sinon 422 (`src/alerts/assignment.ts`). `GET /products/{id}/assignees` (droit
  `content.write` sur le produit) liste les personnes assignables.
- **Notification par l'outbox existante (ADR 0011)** : `notification_dispatch` gagne `kind`
  (`alert` | `task_assigned`) et `task_id` ; une contrainte impose le sujet propre à chaque
  type. Une ligne par (tâche, assigné, version) via `dedup_key`, dans la transaction auditée
  de la création ou du `PATCH`. Rien pour soi-même, ni si l'assigné ne change pas. Le
  dispatcher saute (`skipped`, audité) une notice dont la tâche a été réassignée entre-temps.
- **Adaptateur e-mail live = Trigenys Notify** (`src/integrations/notify/mailer.ts`) :
  `POST {NOTIFY_EMAIL_BASE_URL}/v1/dispatch/{NOTIFY_PROJECT}/email`, clé produit dans
  `x-notify-auth`. Notify refuse un événement de plus de 5 minutes : chaque tentative est un
  événement neuf dont l'id est le SHA-256 de `projet:dispatchId:tentative` (`Mail.key`), donc
  un rejeu HTTP d'une même tentative est dédoublonné par Notify. Lien magique : expiration
  15 min ; autres : 24 h (plafond Notify). En cas d'échec, seul le statut HTTP est remonté
  (le corps peut contenir le destinataire, la clé n'est jamais journalisée).
- **MCP** : `list_assignees`, `create_task`, `assign_task` (concurrence optimiste : `version`
  lue par `get_task`, 409 si périmée), toujours rejoués sur les routes REST (ADR 0012).

## Conséquences

- Le téléphone de la prestataire reçoit l'e-mail (notification du client mail) avec le lien
  direct vers la tâche ; elle se connecte par lien magique ou passkey avec un rôle `operator`
  limité à ses produits.
- Côté Notify, le propriétaire ajoute le projet `trigenys-studio` à `EMAIL_PROJECTS_JSON`
  (expéditeur) et le secret `EMAIL_TRIGENYS_STUDIO_INGEST_KEY` ; côté Studio,
  `INTEGRATION_EMAIL_MODE=live`, `NOTIFY_EMAIL_BASE_URL` et le secret `NOTIFY_EMAIL_INGEST_KEY`.
- Migration additive (`0010`) : les notices d'alerte existantes prennent `kind = 'alert'`.

## Suites (hors de cette décision)

- **WhatsApp** : nécessite une route générique `/v1/dispatch/{project}/whatsapp` dans Notify
  vers un groupe approuvé (WAHA n'envoie qu'aux groupes `@g.us` listés) ; le studio ajoutera
  alors un canal `whatsapp` au dispatcher, sans changer le modèle.
- **ChatGPT et claude.ai (connecteurs distants)** exigent OAuth 2.1 sur le serveur MCP ; le
  bearer actuel suffit pour Claude Code / Claude Desktop. À traiter avec le plugin MCP/OIDC de
  Better Auth une fois le studio déployé.
