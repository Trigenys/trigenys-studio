# ADR 0003 — Topologie : monorepo `trigenys-studio`

- Statut : accepté — 2026-11-05
- Issue : #2

## Contexte

Studio comprend un web, un backend, un mobile Android/iOS et un contrat API partagé. AppFactory provisionne habituellement un dépôt par application, et sa convention Neon attend un Worker nommé `<repo>-api`.

## Options

1. **Dépôts séparés** provisionnés par AppFactory (`trigenys-studio`, `trigenys-studio-api`, `trigenys-studio-mobile`). Rejeté : le Worker devrait s'appeler `trigenys-studio-api-api`, trois boards à synchroniser, contrats à propager entre dépôts.
2. **Monorepo** `trigenys-studio` avec `apps/web`, `apps/mobile` (`shared/`, `androidApp/`, `iosApp/`), `services/api`, `packages/contracts`, `docs/adr`. Retenu.

## Décision

Option 2. Workspaces npm à la racine pour les paquets TypeScript ; Gradle indépendant sous `apps/mobile`. Un seul Project GitHub. Analyse d'impact AppFactory (`.github/appfactory-impact.json`) : chaque surface déclenche uniquement ses gates ; `packages/contracts` est transversal et déclenche volontairement api, web et mobile. Release Please en mode manifest, un composant par application (`web`, puis `api`, `android`, `ios`).

## Conséquences

- Le socle web est déplacé dans `apps/web` sans réinitialisation (`git mv`) ; les scripts racine `typecheck`/`build` conservent le contrat CI existant.
- Le marqueur `.appfactory/webapp.json` reste à la racine, propriété d'AppFactory ; la matérialisation de blueprints dans un sous-chemin est une contribution amont (U2).
- Pas de runner macOS tant que `apps/mobile` ne change pas.
