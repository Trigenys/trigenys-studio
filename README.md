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

## CI / automatisation

- **CI change-scoped** : `.github/appfactory-impact.json` décrit les surfaces ; seuls les gates impactés s'exécutent (`reusable-impact-analysis`).
- **Project Automation** : issues et PR synchronisées sur le board via le broker OIDC (zéro PAT).
- **Release** : Release Please en mode manifest, un composant par application.

Les workflows réutilisables sont épinglés sur un SHA revu d'AppFactory Project Automation.

## Principes

RAIDER (Reusable, Agnostic, Idempotent, Durable, Engineering-grade, Retroactive) et le contrat `AGENTS.md`. Aucune publication ni connexion à un compte externe sans validation humaine explicite ; aucun identifiant en dépôt.

## AppFactory

Preset d'origine : `react-vite`, blueprint version `1` (marqueur `.appfactory/webapp.json`).
