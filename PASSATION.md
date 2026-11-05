# PASSATION — Trigenys Studio

Journal de passation en ajout seul. Chaque session ajoute une entrée datée à la fin ; une info devenue fausse est corrigée par une nouvelle entrée.

## 2026-11-05 15:23 — Conception architecture + démarrage incréments 0–1

**État**
- Repo cloné dans `Documents\Projets\trigenys-studio`, branche `feat/foundation-architecture` créée depuis `main` (e302933).
- Architecture cible conçue et consignée dans `docs/architecture/target-architecture-draft.md` : web React/Vite (existant) + Compose Multiplatform Android/iOS ; Worker Cloudflare `trigenys-studio-api` (Hono + Drizzle) → Neon via Hyperdrive (provisionnement AppFactory `POST /infrastructure/neon`, bail OIDC CI) ; monorepo `apps/web`, `apps/mobile`, `services/api`, `packages/contracts` ; Better Auth, RBAC déclaratif, audit append-only, OpenAPI → clients TS/Kotlin.
- Backlog : issues #1–#12 + #15 ouvertes, aucune PR. Plan de livraison en 13 incréments dans le brouillon d'architecture.
- Projects GitHub doublons : #24 (13 items, canonique) et #25 (7 items dont #13 Done absent de #24).

**Décisions / verrous**
- Pas de PWA ni Expo : natif via Compose Multiplatform (stable iOS depuis 1.8).
- Neon plutôt que Supabase (choix du commanditaire).
- Contributions amont à ouvrir (U1–U8, voir brouillon) ; `reusable-release.yml` supporte déjà le mode manifest (U7 non nécessaire).
- Prérequis externes non bloquants avant l'incrément 2 : Neon project id, compte Cloudflare ; inc. 7 : Apple Developer ; vérifier l'accès API Buffer tôt.

**Prochaine étape**
1. #15 : ajouter #13 au Project #24 (Done), fermer #25 (pas de suppression), vérifier le lien repo.
2. #1 : `docs/discovery.md`.
3. #2a : ADR 0001–0004 dans `docs/adr/`, `git mv` du web vers `apps/web` (CI verte), `.github/appfactory-impact.json` + workflow impact-aware, Release Please manifest.
4. PR sur `main`, puis issues amont U1/U2.

## 2026-11-05 15:34 — PR fondation ouverte, issues amont U1/U2

- PR #17 `feat/foundation-architecture` → `main` ouverte avec section RAIDER review ; CI verte (impact / analyze, web, release-config, ci-summary ; project automation OK).
- Issues amont ouvertes dans `Trigenys/appfactory` : #185 (U1, cible Neon `APPFACTORY_NEON_TARGETS`, bloquante incrément 2) et #186 (U2, `targetPath` monorepo, non bloquante).
- Reste côté propriétaire : merger #17 ; fermer le Project doublon #25 (`gh auth refresh -s project` ou UI) → clôture #15 ; traiter #185 côté serveur (projectId/branchId Neon à renseigner).
- Prochain incrément (2) : `services/api` Worker Hono + Drizzle, contrat OpenAPI dans `packages/contracts`, spike connexion Hyperdrive/Better Auth. Pré-requis : #185 appliqué, compte Cloudflare.

## 2026-11-05 15:47 — Incrément 2 : socle API Worker + contrat OpenAPI (PR #19)

- PR #17 (fondation) mergée en squash sur `main`. Branche `feat/api-foundation` → PR #19.
- `services/api` : Hono + zod-openapi, `/health` (`deep=true` ping DB via Hyperdrive), `/openapi.json`, problem documents RFC 9457, client Drizzle/postgres.js par requête, contrats d'intégration (publisher/cms/metrics/llm) + mocks déterministes, `INTEGRATION_<X>_MODE` (live sans adaptateur = erreur explicite). 8 tests vitest.
- `packages/contracts` : `openapi.json` commité, `schema.d.ts` généré, client openapi-fetch ; scripts `openapi:check` (api) et `check` (contracts) vérifient la dérive dans les deux sens.
- CI : surfaces `api`, `contracts`, `workspace` ; gates typecheck/test/drift/dry-run. Release Please : composants `api` (bump `src/version.ts`) et `contracts`.
- Décisions : vitest en runtime Node (pas vitest-pool-workers) tant que les routes n'exigent pas de bindings ; `postgres` 3.x (drizzle 0.45 peer >=3) ; types workers v5 (plus d'entrée datée).
- Bloqué pour déployer : appfactory#185 (cible Neon, id Hyperdrive), compte Cloudflare, domaine API. Première migration sous bail OIDC à faire dès que #185 est appliqué.
- Suite (incrément 3, #3) : Better Auth (passkeys + magic link, bearer mobile) sur tables Neon, RBAC `role_assignment`, `audit_event` append-only, tests 401/403 par route. Spike compat Better Auth / postgres.js / Workers à faire en premier.

## 2026-11-05 16:09 — Incrément 3 : Better Auth, RBAC, audit (PR #22)

- Branche `feat/auth-rbac`, commit `5791e01`, PR #22 → `main` (Closes #3). Non mergée.
- Livré : Better Auth (magic link, passkey, bearer) sous `/api/auth/*`, migrations Drizzle 0000/0001
  (trigger append-only sur `audit_event`), RBAC admin/operator/reviewer + `authorize()`, routes `/me`
  et `/roles`, contrat OpenAPI + client régénérés, harnais PGlite (24 tests verts), `erasableSyntaxOnly`,
  LESSON-STUDIO-2026-002.
- Prochaine étape : vérifier la CI de #22, merger, puis incrément 4 (schéma pipeline de contenu,
  machine à états, routes `content` branchées sur `content.publish`).
- Toujours côté propriétaire : appfactory#185 (cible Neon), compte Cloudflare, Project #25 en double.

## 2026-11-05 16:36 — Incrément 4 : pipeline de contenu (PR #23)

- Branche `feat/pipeline`, PR #23 (Closes #5), en attente de CI/merge.
- Migration 0002 : product, task, content_version, comment, approval, task_transition, idempotency_key.
- `src/pipeline/definition.ts` (états/transitions/gardes déclaratifs) + `engine.ts` (snapshot, gardes, applyTransition sous FOR UPDATE).
- Approbation liée à content_hash + asset_set_hash (placeholder sha256('[]') jusqu'aux visuels) ; quatre yeux ; nouvelle version → `preparing`.
- `src/idempotency.ts` : Idempotency-Key par acteur, 422 si réutilisée avec un autre payload.
- Preuve : vitest 38/38, typechecks, openapi:check, contracts check, wrangler dry-run.
- Prochain : incrément 5 (shell web « Ma journée ») après merge. Blocages owner inchangés : appfactory#185 (Neon), compte Cloudflare, Project #25 doublon.
- Piège harness : les heredocs bash avec certaines quotes échouent (« unexpected EOF ») → écrire les fichiers via Write/Edit ou python.

## 2026-11-05 17:00 — Incrément 5 : shell web « Ma journée » (PR #24)

- **État** : PR #24 (`feat/web-shell` → `main`, Closes #4) ouverte, en attente de « ok » pour merge. Typecheck, build web, API 38/38, Playwright 14/14 (desktop + Pixel 7).
- **Livré** : react-router (URL = vue/produit/q), React Query, `views.ts` pur (Aujourd'hui / À valider / Programmées / En retard, recherche sans accents), Login magic link + passkey, page tâche (transitions, approbation), états vide/chargement/erreur, a11y clavier, Vite proxy API → :8787 (bypass HTML), CI gate `web` installe Chromium. ADR 0005.
- **Leçons** : (1) port 5173 occupé par un autre projet sur cette machine → Playwright/Vite sur 5190 strict ; (2) un `page.route` Playwright intercepte aussi la navigation de document (`/tasks/<id>` recevait le JSON) → `route.continue()` si `resourceType === "document"` ; (3) better-auth doit être à la même version dans api et web (1.7.18) sinon copies imbriquées.
- **Verrous inchangés** : appfactory#185 (cible Neon), compte Cloudflare, Project #25 doublon (issue #15).
- **Prochaine étape** : après merge, incrément 6 = prochaine issue P0 du backlog (`gh issue list --label P0`), probablement le flux éditorial côté web (création de tâche, versions, commentaires) ou le mobile Compose Multiplatform.

## 2026-11-05 17:24 — Incrément 6 : flux éditorial web (PR #26)

- Issue #25 livrée sur `feat/web-editorial` : `/tasks/new`, édition des métadonnées (version optimiste, 409 + « Recharger »), versions de contenu avec historique replié, commentaires, motif sur « À corriger » / « Échec », historique des transitions.
- Contrat : `ContentVersion` et `Approval` ne sont plus nullables (`z.union([Schema, z.null()])` dans `TaskDetail`) ; OpenAPI et `schema.d.ts` régénérés.
- Preuve : typecheck OK, build web OK, API 38/38, Playwright 28/28 (desktop + Pixel 7).
- Leçons : (1) `.nullable()` sur un schéma `.openapi("Nom")` rend le composant lui-même nullable → union explicite à l'usage ; (2) un `<details>` replié rend ses enfants (locators stricts en doublon, requêtes inutiles) → rendu paresseux à l'ouverture ; (3) les routes Playwright interceptent aussi les navigations document → `route.continue()` quand `resourceType() === "document"`.
- Suite : merge de #26 puis incrément 7 (client mobile Compose Multiplatform ou #12 release). Bloqueurs côté propriétaire inchangés : Neon (appfactory#185), compte Cloudflare, Project en doublon (#15).
