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
