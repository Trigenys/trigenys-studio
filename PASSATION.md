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

## 2026-11-05 17:53 — Incrément 7 en cours : socle mobile KMP (issue #27)

- État : `apps/mobile/` écrit (Gradle 9.6.0 sans wrapper, AGP 9.4.0, Kotlin 2.4.20, CMP 1.12.2, material3 1.9.0, ktor 3.6.1, compileSdk/targetSdk 36, minSdk 26) : `shared` (DTO miroir du contrat, client ktor + Idempotency-Key, TokenStore, MagicLink, vues/tri identiques à `apps/web/src/views.ts`, AppModel StateFlow, écrans SignIn/Day/Task) + `androidApp` (MainActivity, App Link sur `/api/auth/magic-link/verify`, jeton en SharedPreferences, test Roborazzi `DayScreenScreenshotTest`). CI : surface `mobile` → gates `mobile-android` (ubuntu) et `mobile-ios` (macOS, link framework) ; `ci-summary` étendu.
- Vérification locale : image Docker `ghcr.io/cirruslabs/android-sdk:36` (JDK 21, licences acceptées ; `platforms;android-37` n'existe pas en tant que tel → compileSdk 36), distribution Gradle montée depuis `~/.gradle/dist/gradle-9.6.0`, cache dans le volume `studio-gradle-cache`. Premier run en cours : `:shared:testAndroidHostTest :androidApp:testDebugUnitTest :androidApp:assembleDebug`.
- Suite : corriger ce que le build remonte, branche `feat/mobile-foundation`, commit technique (sans mention d'IA, sans trailer), PR avec section RAIDER review, CI (y compris job macOS), puis nouvelle entrée ici avec le numéro de PR.

## 2026-11-05 18:46 — Incrément 7 livré : PR #28 (socle mobile KMP, issue #27)

- PR https://github.com/Trigenys/trigenys-studio/pull/28 sur `feat/mobile-foundation`, CI verte : `mobile-android` (tests communs 13/13 + Roborazzi 1/1 + APK, 4m36) et `mobile-ios` (link framework simulateur, 5m59) ; surfaces web/api/contracts inchangées et vertes.
- Correctifs du premier build : compileSdk 37.2 via `compileSdk { version = release(37) { minorApiLevel = 2 } }` (AndroidX récent exige ≥ 37 ; seules versions mineures 37.x publiées) ; bloc `android {}` du plugin KMP (Gradle 9.6 traite les dépréciations de script en erreurs) ; artefacts Compose explicites au catalogue ; `Month.ordinal + 1` (kotlinx-datetime 0.8) ; `PrimaryTabRow` ; `headersOf(pairs)` ; `createComposeRule` v2 ; kotlinx-datetime au classpath de test d'`androidApp`.
- Vérification locale : image dérivée `studio-android-sdk:37.2` (Dockerfile dans le scratchpad : `FROM ghcr.io/cirruslabs/android-sdk:36` + `sdkmanager --install "platforms;android-37.2"`), Gradle monté depuis `~/.gradle/dist/gradle-9.6.0`, volume `studio-gradle-cache` ; run ≈ 6–7 min à cache chaud.
- Suite : à l'« ok » du propriétaire, squash-merge #28 puis incrément suivant (#12 release / projet Xcode selon disponibilité macOS). Bloqueurs côté propriétaire inchangés : Neon (appfactory#185), compte Cloudflare, Project en doublon (#15).

## 2026-11-05 19:10 — Incrément 8 livré : PR #29 (release readiness, issue #12)

- Branche `feat/release-readiness` → PR #29 (Closes #12). Vérifié en local : tsc web, `vite build`, Playwright 36/36 (18 scénarios × desktop + Pixel 7), contrôle Release Please (4 packages), YAML/JSON parsés. CI de la PR en cours au moment de l'écriture (gates `web`, `visual-qa`, `release-config`, `mobile-android`, `mobile-ios`).
- Contenu : gate `visual-qa` (registry `reusable-visual-qa.yml@8847e4888fc4021060f06ba29f0cf94677ed2d7d`, config `.github/appfactory-visual-qa.json`, route `/login`, CTA lien interne `/today` ajouté à la page de connexion) ; axe dans Playwright (`apps/web/e2e/accessibility.spec.ts`) qui a révélé un défaut de contraste sur `.btn-primary` → `--accent-strong: #4f46e5` ; scénario e2e « rejeter » ; composant Release Please `mobile` (`versionName` annoté) ; `docs/operations.md` ; `services/api/.dev.vars.example` + `.dev.vars` ignoré ; LESSON-STUDIO-2026-003/-004 ; favicon SVG (évite un 404 console sur la gate Visual QA).
- Verrous inchangés (propriétaire) : appfactory#185 (Neon/Hyperdrive), compte Cloudflare, Project doublon #15, `APPFACTORY_RELEASE_TOKEN`. Aucun déploiement activé.
- Écart documenté : Visual QA épinglé sur `8847e48…`, impact/release toujours sur `0523510a…` (le runner n'existe pas à l'ancien SHA) ; aligner à la prochaine revue du registry.
- Suite : si la gate `visual-qa` échoue en CI (console, Lighthouse), corriger sur la même branche ; à l'« ok » du propriétaire, squash-merge #29 puis incrément suivant (projet Xcode / composant release iOS, ou intégrations réelles selon disponibilité des prérequis).

## 2026-11-05 19:57 — Incrément 9 livré : PR #31 (dossier éditorial et assistant)

- Branche `feat/editorial-assistant`, commit 363e2e6, PR https://github.com/Trigenys/trigenys-studio/pull/31 (Closes #6). CI en cours à l'écriture de cette entrée.
- Livré : `task_source` + `ai_interaction` (migration 0003), routes `dossier.ts` (sources, assistant, accept, dismiss), adaptateur `integrations/anthropic/llm.ts` (mock par défaut, `live` = secret Worker `ANTHROPIC_API_KEY`, `LLM_MODEL` facultatif), web `Dossier.tsx` / `Assistant.tsx` / `diff.ts`, ADR 0006.
- Preuves : API 51/51, dry-run ok, contracts/openapi check ok, web typecheck+build ok, Playwright 44/44.
- Leçon : Playwright `getByLabel` matche par sous-chaîne et compte les sections `aria-labelledby` ("Action" ↔ section "Actions", "Titre" ↔ "Titre de la source"). Les libellés de formulaire doivent rester uniques sur une page : assistant → "Intervention" / "Destination", source → "Nom de la source". Le message « Contenu gelé » est affiché à tous les rôles.
- Reste : après merge, incrément suivant du backlog (vérifier les issues ouvertes) ; suivi noté : aligner impact/release sur le SHA registry 8847e488 après relecture du diff.

## 2026-11-05 20:22 — Incrément 10 démarré : #7 imports CMS Insight + radar Editorial OS

- PR #31 mergée (0b45755). Branche `feat/imports-cms-radar`.
- Discovery (lecture gh) : Insight = `POST {INSIGHT_BASE_URL}/api/editorial-os` body `{operation:"list-posts", locale, status, publishedAfter, sort:"-updatedAt", page, limit≤100}`, Bearer `INSIGHT_PUBLISHING_TOKEN`, docs `PostSummary{id,slug,title,excerpt,status,heroImage,updatedAt,publishedAt,translationPresent}` ; pas de webhook. Editorial OS = `GET {EDITORIAL_OS_BASE_URL}/api/operator/runs?topic_decision=PROPOSE&updated_after=&limit≤100`, Bearer `EDITORIAL_OS_TOKEN`, `OperatorRunSummary{id,topic_title,topic_proposed_angle,topic_proposed_format,topic_sources[],topic_composite_score,vertical_key,created_at,updated_at}`.
- Design : table `import_item(origin cms|radar, external_ref UNIQUE par origine, title, url, summary, payload jsonb, observed_at, status new|linked|ignored, task_id)` ; `POST /imports/sync` (upsert, jamais de reset du statut), `GET /imports`, `POST /imports/{id}/task` (tâche + sources origin cms/radar), `POST /imports/{id}/ignore` ; adaptateurs `Radar`/`Cms` live derrière secrets, mock par défaut ; web page « Entrées ». Lecture seule côté CMS (droits respectés).

## 2026-11-05 20:37 — Incrément 10 livré : PR imports CMS Insight + radar Editorial OS

- API : `import_item` (migration `0004_imports`), routes `/imports` (list, sync, get, task, ignore), adaptateurs `InsightCms` et `EditorialOsRadar` (`fetch` injectable, `UpstreamError` → 502), `MockRadar`, mode `INTEGRATION_RADAR_MODE`. Tests : 64 API verts, adaptateurs testés sans réseau.
- Web : page « Entrées » (`/imports`), lien depuis Ma journée, hooks `useImports/useSyncImports/useLinkImport/useIgnoreImport`, mock e2e étendu, 48 Playwright verts.
- ADR 0007. Leçon : un `ul` imbriqué dans une carte fait compter ses `li` par `getByRole("listitem")` → cibler `list.locator("> li")`.
- Reste : locale EN du CMS et synchronisation planifiée (hors périmètre #7).

## 2026-11-05 20:44 — PR #32 : CI web rouge, locators e2e corrigés

- Cause : `getByRole("status")` ambigu sur mobile (rapport de synchro + état vide encore monté) et `getByLabel("Produit")` qui attrape la nav du tableau de bord pendant la transition. Correction : `filter({ hasText })` et `getByRole("combobox", { name })`. Leçon : viser le rôle précis dès qu'un libellé est partagé entre une nav et un champ.
- Dépôt GitHub = `Trigenys/trigenys-studio` (pas EagleFox31) : les logs de job se lisent via `gh api --allow-escape-sequences repos/Trigenys/trigenys-studio/actions/jobs/<id>/logs`.
- Suite : merge #32 dès CI verte, puis incrément 11 = #8 (pipeline visuel et brand kits).
