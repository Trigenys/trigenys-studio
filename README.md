# Trigenys Studio

Cockpit interne de production et de communication Trigenys : pilotage des contenus, validation humaine, programmation et reporting pour Trigenys Insight, Précis Translator et Atelier Maître.

Dépôt généré par Trigenys AppFactory, organisé en monorepo.

## Structure

| Chemin | Contenu | État |
|---|---|---|
| `apps/web` | Cockpit web — React 19, TypeScript, Vite | socle |
| `apps/mobile` | Android + iOS — Kotlin / Compose Multiplatform | à venir |
| `services/api` | API — Cloudflare Worker, Hono, Drizzle, Neon | en production (REST, MCP, outbox de notifications) |
| `packages/contracts` | Contrat OpenAPI 3.1 (`openapi.json`) et client TypeScript généré | socle |
| `docs/adr` | Décisions d'architecture | ADR 0001–0004 |
| `docs/discovery.md` | Personas, parcours, RBAC, règles de validation | — |
| `docs/architecture` | Architecture cible et plan de livraison | — |

## Développement

```bash
npm install
npm run dev          # apps/web
npm run typecheck    # tous les workspaces
npm run build
npm test                                  # services/api : vitest
npm run openapi:export -w services/api    # régénère packages/contracts/openapi.json
npm run generate -w packages/contracts    # régénère le client TypeScript
```

### Web en local

`npm run dev` (Vite, port 5173) proxie les routes de l'API vers le Worker sur `localhost:8787` : lancer aussi `npm run dev -w services/api`. « Ma journée » (`/today`, `/review`, `/scheduled`, `/late`) dérive ses vues côté client (`apps/web/src/views.ts`) à partir d'une liste par produit ; l'URL porte la vue, le produit (`?product=`) et la recherche (`?q=`). La session vient de `GET /me` ; la connexion passe par le client Better Auth (lien magique, passkey). En production, `VITE_API_URL` désigne le Worker (vide = même origine). Tests : `npm test -w apps/web` lance Playwright (profils desktop et Pixel 7) contre une API mockée au niveau réseau (`apps/web/e2e/api-mock.ts`), sans base ni Worker. Voir ADR 0005.

### Tester l'application en local (sans déploiement)

1. **Base** : une branche de développement Neon (gratuit) ou un Postgres local, par exemple
   `docker run -d --name trigenys-studio-pg -e POSTGRES_PASSWORD=studio-local -e POSTGRES_DB=studio -p 127.0.0.1:5434:5432 postgres:16-alpine`.
   Copier `services/api/.dev.vars.example` en `services/api/.dev.vars` (jamais commis) pour
   `AUTH_SECRET` et `PASSKEY_RP_ID`. L'URI de la base se passe à wrangler par la variable
   d'environnement `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` (wrangler 4 ne la lit
   pas dans `.dev.vars`) ; en local, préférer `127.0.0.1` à `localhost` et `?sslmode=disable`.
2. **Migrations** : `DATABASE_URL="<même URI>" npm run db:migrate -w services/api`. Si
   `drizzle-kit migrate` reste sans sortie, appliquer les fichiers `services/api/drizzle/*.sql`
   dans l'ordre avec `psql` (retirer les marqueurs `--> statement-breakpoint`).
3. **Lancer** : `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="<URI>" npm run dev -w services/api`
   (Worker, 8787) puis `npm run dev` (web, 5173 ; si Vite choisit un autre port, l'ajouter à
   `AUTH_TRUSTED_ORIGINS` dans `.dev.vars`). `GET /health?deep=true` doit répondre `"database":"ok"`.
   Les intégrations externes sont en `mock` : rien ne part vers Buffer, le CMS ou un fournisseur
   d'e-mail. Les médias utilisent le simulateur R2 local de Wrangler (`VISUALS`), qui conserve
   les fichiers entre les requêtes ; il n'accède pas au bucket de production.
4. **Se connecter** : sur `http://localhost:5173`, demander un lien magique ; le lien est écrit
   dans la console du Worker (`[mock-mailer]`), l'ouvrir dans le navigateur.
5. **Premier admin et produits** : aucun rôle ni produit n'existe au départ, et l'interface
   ne les crée pas (routes admin `POST /roles`, `POST /products`). Une seule fois, après la
   première connexion, exécuter `services/api/scripts/bootstrap-local.sql` dans la console
   SQL Neon (ou `psql`) avec votre e-mail : il donne le rôle admin et crée les trois produits.
   Rejouable sans effet. **En production**, après la première connexion : lancer le workflow
   `AppFactory infrastructure` à la main avec l'entrée `admin_email` (seul ce workflow obtient
   la base, par bail AppFactory) ; même effet, idempotent, audité `admin.bootstrap`.
6. **Données** : créer un brand kit, des comptes sociaux et des tâches depuis l'interface ;
   « Vérifier maintenant » sur `/alerts` calcule les alertes.

### API en local

`npm run dev -w services/api` démarre le Worker avec wrangler. Les intégrations externes sont en mode `mock` par défaut (`INTEGRATION_<X>_MODE`) ; les médias utilisent R2 simulé localement pour rester lisibles entre les requêtes. Pour la base, exporter `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` (branche Neon de développement ou Postgres local, voir « Tester l'application en local ») ; aucune URI n'est commise. La CI vérifie que `openapi.json` et `schema.d.ts` sont à jour par rapport au code.

Authentification (Better Auth, tables dans Neon via Drizzle) : passkeys et magic link, sans mot de passe ; les clients natifs utilisent le jeton `set-auth-token` en `Authorization: Bearer`. Variables : `AUTH_SECRET` (secret Worker, 32 caractères minimum, jamais commis), `AUTH_BASE_URL`, `AUTH_TRUSTED_ORIGINS`, `PASSKEY_RP_ID`/`PASSKEY_RP_NAME`. En mode `INTEGRATION_EMAIL_MODE=mock`, le lien magique est écrit dans les logs du Worker.

Autorisation : rôles `admin`, `operator`, `reviewer` (`role_assignment`, éventuellement par produit) et politiques déclaratives dans `services/api/src/auth/rbac.ts` ; `authorize(action, resource)` répond 401/403 (problem+json). Chaque changement d'état passe par `audited()` : la ligne `audit_event` est écrite dans la même transaction, et un trigger rend la table append-only.

Pipeline de contenu : `product`, `task` (machine d'états déclarée dans `services/api/src/pipeline/definition.ts`, moteur générique dans `engine.ts`), `content_version`, `comment`, `approval` et `task_transition`. Chaque transition porte son action RBAC et un garde éventuel ; `approved` n'est atteignable que par une décision (`POST /tasks/{id}/approvals`, quatre yeux : l'auteur de la dernière version ne décide pas) liée au `content_hash` et à l'`asset_set_hash` de la version approuvée, invalidée dès qu'une nouvelle version arrive. Les `PATCH` exigent `version` (concurrence optimiste, 409 si périmé) ; les `POST` acceptent un en-tête `Idempotency-Key` (rejeu de la réponse pour une requête identique, 422 si la clé est réutilisée avec un autre contenu).

MCP : `POST /mcp` (Streamable HTTP sans état, réponses JSON) expose seize outils qui rejouent les routes REST en processus avec les droits de l'appelant (bearer ou cookie, mêmes 401/403, même audit, `Idempotency-Key` via l'argument `idempotencyKey`). La table des outils est dans `services/api/src/mcp/tools.ts` ; le point d'entrée n'apparaît pas dans `openapi.json` (ADR 0012).

Parcours prestataire (ADR 0013) : un admin donne à la prestataire un rôle `operator` sur ses produits ; elle se connecte depuis son téléphone par lien magique ou passkey et filtre « mes tâches ». Le travail lui est confié depuis le cockpit, l'API (`POST /tasks` ou `PATCH /tasks/{id}` avec `assigneeId`) ou un assistant via MCP (`list_assignees` → `create_task` / `assign_task`). Chaque assignation à quelqu'un d'autre met un e-mail en file (outbox des notifications), envoyé par Trigenys Notify en mode `INTEGRATION_EMAIL_MODE=live`, avec le lien direct vers la tâche. En option (ADR 0014), la même assignation est postée dans le groupe WhatsApp d'équipe via Trigenys Notify (`WHATSAPP_NOTIFY_EVENTS=task_assigned`, `INTEGRATION_WHATSAPP_MODE=live`), sans adresse e-mail ni brief.

Migrations : `npm run db:generate -w services/api` après un changement de `src/db/schema.ts`, `npm run db:migrate -w services/api` avec `DATABASE_URL`. Les tests rejouent les migrations sur PGlite (Postgres en mémoire), sans base externe.

## Production : web, API et MCP

Un seul Worker sert l'application web, l'API REST et le serveur MCP, sur la même origine :
`https://trigenys-studio-api.lawrynnjennifer.workers.dev` (variables `AUTH_BASE_URL` et `WEB_APP_URL`
de `services/api/wrangler.production.jsonc`).

| Chemin | Rôle |
|---|---|
| `/` | Cockpit web (connexion par lien magique ou passkey) |
| `/health?deep=true` | Santé du Worker et de la base |
| `/openapi.json` | Contrat OpenAPI 3.1 de l'API REST (client TypeScript : `packages/contracts`) |
| `/mcp` | Serveur MCP (Streamable HTTP sans état, `POST`) |

Les logos et visuels sont conservés dans le bucket privé R2 `trigenys-studio-media`, lié au
Worker sous `VISUALS`. Le workflow d'infrastructure le provisionne via AppFactory avant la
release et vérifie que son domaine public géré est désactivé. Les fichiers restent servis
par l'API avec les droits du compte connecté (ADR 0017).

### Jeton d'accès (API et MCP)

L'API et le MCP acceptent la session du navigateur (cookie) ou un jeton `Authorization: Bearer`.
Pour obtenir le jeton d'un compte :

1. se connecter sur le cockpit ;
2. dans le même navigateur, ouvrir `/api/auth/get-session` : la réponse JSON contient `session.token` ;
3. utiliser cette valeur comme `Authorization: Bearer <jeton>`.

Le jeton porte exactement les droits de son compte (rôles `admin`, `operator`, `reviewer`) et vaut
30 jours ; la déconnexion le révoque. C'est un secret : ne jamais le committer, le coller dans un
ticket ou le journaliser.

```bash
curl -H "Authorization: Bearer $STUDIO_TOKEN" https://trigenys-studio-api.lawrynnjennifer.workers.dev/me
```

### Brancher un assistant (MCP)

Tout client MCP qui accepte un en-tête HTTP personnalisé, par exemple Claude Code :

```bash
claude mcp add --transport http trigenys-studio https://trigenys-studio-api.lawrynnjennifer.workers.dev/mcp --header "Authorization: Bearer $STUDIO_TOKEN"
```

Les connecteurs qui exigent une connexion OAuth (connecteurs personnalisés de claude.ai, par exemple)
ne sont pas encore pris en charge : l'autorisation OAuth 2.1 du MCP est l'étape suivante.

Seize outils, avec les mêmes droits, le même audit et les mêmes erreurs que le REST (ADR 0012,
table dans `services/api/src/mcp/tools.ts`) :

| Domaine | Outils |
|---|---|
| Tâches | `list_tasks`, `get_task`, `create_task`, `assign_task`, `list_assignees` |
| Validation | `decide_approval` |
| Publication | `list_social_accounts`, `check_publish_readiness`, `schedule_task` |
| Imports | `list_imports`, `sync_imports`, `create_task_from_import`, `ignore_import` |
| Alertes | `list_alerts`, `acknowledge_alert` |
| Reporting | `get_editorial_report` |

### Donner accès à une personne

1. La personne se connecte une fois sur le cockpit (lien magique), puis ouvre `/me` et transmet son
   `userId`.
2. Un admin lui donne un rôle : `POST /roles` avec `{"userId": "...", "role": "operator", "productId": null}`
   (`productId` limite le rôle à un produit : `insight`, `precis`, `atelier`). L'opération est auditée
   et rejouable sans effet.
3. Elle apparaît alors dans `list_assignees` ; chaque tâche qui lui est assignée lui envoie un e-mail
   (et un message au groupe WhatsApp d'équipe si activé, voir ADR 0013 et 0014).

Le premier admin d'un environnement ne passe pas par l'API : voir « Premier admin et produits » plus haut.

## CI / automatisation

- **CI change-scoped** : `.github/appfactory-impact.json` décrit les surfaces ; seuls les gates impactés s'exécutent (`reusable-impact-analysis`).
- **Project Automation** : issues et PR synchronisées sur le board via le broker OIDC (zéro PAT).
- **Visual QA** : `.github/appfactory-visual-qa.json` liste les pages publiques vérifiées par `reusable-visual-qa.yml` (captures, clavier, axe, motion réduite, budgets Lighthouse) ; les écrans derrière la session sont couverts par axe dans Playwright (`apps/web/e2e/accessibility.spec.ts`).
- **Release** : Release Please en mode manifest, un composant par application (`web`, `api`, `contracts`, `mobile`).
- **Exploitation** : environnements, politique de secrets, staging avant production et versioning dans [docs/operations.md](docs/operations.md).

Les workflows réutilisables sont épinglés sur un SHA revu d'AppFactory Project Automation.

## Principes

RAIDER (Reusable, Agnostic, Idempotent, Durable, Engineering-grade, Retroactive) et le contrat `AGENTS.md`. Aucune publication ni connexion à un compte externe sans validation humaine explicite ; aucun identifiant en dépôt.

## AppFactory

Preset d'origine : `react-vite`, blueprint version `1` (marqueur `.appfactory/webapp.json`).
