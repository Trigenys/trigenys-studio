# ADR 0012 — Serveur MCP en façade des routes REST

Statut : accepté · Date : 2026-11-07 · Issue : — (demande directe)

## Contexte

Un agent (assistant de l'opérateur, automatisation) doit pouvoir piloter le studio : lire les
entrées importées, créer des tâches, approuver, programmer une publication, acquitter des
alertes. Le Model Context Protocol (MCP) est le standard que ces clients parlent. Le risque est
d'ouvrir un second chemin vers les données, avec ses propres règles d'accès, qui diverge du
REST au fil des évolutions et contourne les politiques RBAC, l'audit et l'idempotence.

## Décision

- **Un outil MCP = une route REST rejouée en processus.** `src/mcp/tools.ts` est une table
  déclarative : nom, description, schéma Zod des arguments, annotations (`readOnlyHint`,
  `destructiveHint`, `idempotentHint`) et projection vers `{ method, path, query, body,
  idempotencyKey }`. Rien dans `src/mcp/` ne touche la base ni les politiques.
- **Le dispatch rejoue la requête à travers `app.fetch`** avec les en-têtes `authorization` ou
  `cookie` de l'appelant et `Idempotency-Key` s'il est fourni. La requête traverse la même
  chaîne de middlewares (session, RBAC, `audited()`, idempotence). Un outil ne peut donc pas
  faire plus que la route qu'il rejoue ; une réponse non 2xx devient un résultat `isError`
  portant le document problem+json tel quel.
- **Transport Streamable HTTP sans état** (`@hono/mcp` + `@modelcontextprotocol/sdk`) sur
  `POST /mcp` : pas d'identifiant de session, réponses JSON, un `McpServer` et un transport par
  requête (compatible Worker, pas de flux SSE à maintenir). `GET` répond 405.
- **Même authentification que le REST.** `sessionMiddleware` résout le principal (bearer ou
  cookie) ; sans session, 401 problem+json avec `WWW-Authenticate: Bearer`. Un en-tête `Origin`
  hors de `AUTH_TRUSTED_ORIGINS` est refusé (403) avant tout outil, pour qu'un site tiers ne
  puisse pas piloter une session cookie.
- **Hors contrat OpenAPI.** Le point d'entrée est monté avec `app.all`, pas par une route
  `createRoute` : `openapi.json` et le client TypeScript ne changent pas. Le contrat exposé aux
  agents est `tools/list`, dérivé de la table.
- **Résultats bornés** à 100 000 caractères, avec les réponses tableau enveloppées dans
  `structuredContent.items`.

## Alternatives écartées

- Outils MCP écrits à la main contre les services : double implémentation des règles d'accès,
  dérive assurée.
- Génération des outils depuis `openapi.json` : couverture mécanique mais descriptions pauvres
  et exposition de routes qui n'ont pas de sens pour un agent (auth, santé, PATCH de brouillon).
  La table explicite choisit treize opérations et les décrit pour un agent.
- Transport avec session (`mcp-session-id`) : état à tenir entre requêtes, inadapté à un Worker
  sans Durable Object ; inutile tant qu'il n'y a ni ressources abonnables ni notifications.

## Conséquences

- Ajouter un outil = ajouter une entrée à la table et un test de parité avec la route.
- Les tests (`test/mcp.test.ts`) vérifient la parité REST/MCP (statuts, 403 identiques,
  idempotence du `schedule_task`), le transport (401, 403 Origin, 405) et l'interopérabilité
  avec le client officiel du SDK.
- Le coût d'un appel d'outil est celui d'une requête HTTP interne (pas de réseau) ; les routes
  restent la seule source de vérité des règles.
