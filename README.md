# Trigenys Studio

Cockpit interne de production et de communication Trigenys : pilotage des contenus, validation humaine, programmation et reporting pour Trigenys Insight, Précis Translator et Atelier Maître.

Dépôt généré par Trigenys AppFactory, organisé en monorepo.

## Structure

| Chemin | Contenu | État |
|---|---|---|
| `apps/web` | Cockpit web — React 19, TypeScript, Vite | socle |
| `apps/mobile` | Android + iOS — Kotlin / Compose Multiplatform | à venir |
| `services/api` | API — Cloudflare Worker, Hono, Drizzle, Neon | socle (`/health`, OpenAPI, mocks d'intégration) |
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

### API en local

`npm run dev -w services/api` démarre le Worker avec wrangler. Les intégrations sont en mode `mock` par défaut (`INTEGRATION_<X>_MODE`). Pour la base, définir `WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` sur une branche Neon de développement ; aucune URI n'est commise. La CI vérifie que `openapi.json` et `schema.d.ts` sont à jour par rapport au code.

Authentification (Better Auth, tables dans Neon via Drizzle) : passkeys et magic link, sans mot de passe ; les clients natifs utilisent le jeton `set-auth-token` en `Authorization: Bearer`. Variables : `AUTH_SECRET` (secret Worker, 32 caractères minimum, jamais commis), `AUTH_BASE_URL`, `AUTH_TRUSTED_ORIGINS`, `PASSKEY_RP_ID`/`PASSKEY_RP_NAME`. En mode `INTEGRATION_EMAIL_MODE=mock`, le lien magique est écrit dans les logs du Worker.

Autorisation : rôles `admin`, `operator`, `reviewer` (`role_assignment`, éventuellement par produit) et politiques déclaratives dans `services/api/src/auth/rbac.ts` ; `authorize(action, resource)` répond 401/403 (problem+json). Chaque changement d'état passe par `audited()` : la ligne `audit_event` est écrite dans la même transaction, et un trigger rend la table append-only.

Migrations : `npm run db:generate -w services/api` après un changement de `src/db/schema.ts`, `npm run db:migrate -w services/api` avec `DATABASE_URL`. Les tests rejouent les migrations sur PGlite (Postgres en mémoire), sans base externe.

## CI / automatisation

- **CI change-scoped** : `.github/appfactory-impact.json` décrit les surfaces ; seuls les gates impactés s'exécutent (`reusable-impact-analysis`).
- **Project Automation** : issues et PR synchronisées sur le board via le broker OIDC (zéro PAT).
- **Release** : Release Please en mode manifest, un composant par application.

Les workflows réutilisables sont épinglés sur un SHA revu d'AppFactory Project Automation.

## Principes

RAIDER (Reusable, Agnostic, Idempotent, Durable, Engineering-grade, Retroactive) et le contrat `AGENTS.md`. Aucune publication ni connexion à un compte externe sans validation humaine explicite ; aucun identifiant en dépôt.

## AppFactory

Preset d'origine : `react-vite`, blueprint version `1` (marqueur `.appfactory/webapp.json`).
