# Trigenys Studio

Cockpit interne de production et de communication Trigenys : pilotage des contenus, validation humaine, programmation et reporting pour Trigenys Insight, Précis Translator et Atelier Maître.

Dépôt généré par Trigenys AppFactory, organisé en monorepo.

## Structure

| Chemin | Contenu | État |
|---|---|---|
| `apps/web` | Cockpit web — React 19, TypeScript, Vite | socle |
| `apps/mobile` | Android + iOS — Kotlin / Compose Multiplatform | à venir |
| `services/api` | API — Cloudflare Worker, Hono, Drizzle, Neon | à venir |
| `packages/contracts` | Contrat OpenAPI et clients générés | à venir |
| `docs/adr` | Décisions d'architecture | ADR 0001–0004 |
| `docs/discovery.md` | Personas, parcours, RBAC, règles de validation | — |
| `docs/architecture` | Architecture cible et plan de livraison | — |

## Développement

```bash
npm install
npm run dev          # apps/web
npm run typecheck    # tous les workspaces
npm run build
```

## CI / automatisation

- **CI change-scoped** : `.github/appfactory-impact.json` décrit les surfaces ; seuls les gates impactés s'exécutent (`reusable-impact-analysis`).
- **Project Automation** : issues et PR synchronisées sur le board via le broker OIDC (zéro PAT).
- **Release** : Release Please en mode manifest, un composant par application.

Les workflows réutilisables sont épinglés sur un SHA revu d'AppFactory Project Automation.

## Principes

RAIDER (Reusable, Agnostic, Idempotent, Durable, Engineering-grade, Retroactive) et le contrat `AGENTS.md`. Aucune publication ni connexion à un compte externe sans validation humaine explicite ; aucun identifiant en dépôt.

## AppFactory

Preset d'origine : `react-vite`, blueprint version `1` (marqueur `.appfactory/webapp.json`).
