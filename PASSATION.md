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

## 2026-11-05 20:51 — Incrément 11 (#8) : plan architecte reçu, implémentation démarre

- PR #32 : fix e2e poussé (commit test(web)), CI en cours ; merge squash dès verte. Branche de travail `feat/visuals-brand-kits` créée depuis le tip de #32 (à rebaser sur main après le squash : `git rebase --onto origin/main feat/imports-cms-radar`).
- Plan retenu : moteur SVG déterministe `svg@1` (Adapt de la route OG satori de Trigenys-Insight, sans wasm), interface `VisualRenderer` ; `MediaStore` (R2 `VISUALS` en live, mémoire en test, `INTEGRATION_MEDIA_MODE`) ; tables `visual_format` (seed 4 formats, migration custom), `brand_kit` (versionné, un seul approved par produit, logo hashé, kit_hash), `visual_asset` (dédup content_hash actif, variantes, discard logique) ; `assetSetHashOf` réel (jeu vide = sha256("[]") conservé) ; routes `/visual-formats`, `/products/{id}/brand-kits`, `/brand-kits/{id}/approve|logo`, `/tasks/{id}/visuals`, `/visuals/{id}/file` ; web : page BrandKits (admin) + section Visuels sur TaskPage ; ADR 0008.
- Ordre : schéma/migrations → renderer+canonical → MediaStore/registry/harness → engine → routes+tests → contrats → web+e2e → ADR/PR.

## 2026-11-05 22:25 — Incrément 11 (#8) implémenté : visuels et kits de marque, vérification en cours

- API : migrations `0005_visuals` (visual_format, brand_kit, visual_asset) + `0006_seed_visual_formats` (article, linkedin, instagram, story) ; `visuals/canonical.ts`, `visuals/svg-renderer.ts` (`svg@1` déterministe), `visuals/brand-kit.ts` (logo ≤ 256 Ko, signature SVG/PNG, `kit_hash`) ; `MediaStore` (`MemoryMediaStore` en mock/tests, `R2MediaStore` sur binding `VISUALS`, `INTEGRATION_MEDIA_MODE`) ; routes `brand-kits.ts` (formats, kits, approve, logo) et `visuals.ts` (render, list, discard, file) ; `assetSetHashOf` réel (jeu vide = sha256("[]")). Tests API 91/91.
- Pièges rencontrés : jsonb réordonne les clés → comparer via `stableStringify` pour l'idempotence des formats ; la variante alimente le schéma de couleurs → la dédup rerend à la variante de chaque actif actif du format.
- Web : hooks `useVisualFormats/useBrandKits/useCreateBrandKit/useApproveBrandKit/useTaskVisuals/useRenderVisual/useDiscardVisual/useBlobUrl` (images derrière la session via object URL + `credentials: include`), `VisualsSection.tsx` dans TaskPage (après Dossier), page `/brand-kits` admin + lien depuis Ma journée. Mock e2e : options `admin`, `approvedKit` ; specs `visuals.spec.ts`, `brand-kits.spec.ts`, 2 contrôles axe. Rappel : `ul` imbriqué (palette) → `list.locator(":scope > li")`.
- Docs : ADR 0008, table secrets `docs/operations.md` (binding `VISUALS`).
- Reste : pass de vérification complète (agent), commit, PR « Closes #8 » avec RAIDER review, CI, puis merge sur « ok ». Suivi hors périmètre : renderer PNG, alignement impact/release sur le SHA registry 8847e488.

## 2026-11-05 22:34 — Incrément 11 : vérification complète verte, commit et PR

- Preuves : API tsc + vitest 91/91, dry-run ok, openapi:check + contrats ok, web tsc + build ok, Playwright 68/68 (desktop + Pixel 7, axe inclus).
- Leçon (même famille que LESSON « getByLabel sous-chaîne ») : « Sous-titre » matche `getByLabel("Titre")` → libellé renommé « Accroche (facultatif) ». Tout nouveau champ sur TaskPage doit éviter de contenir un libellé existant.
- Suite : commit sur `feat/visuals-brand-kits`, PR « Closes #8 » avec RAIDER review, CI, merge squash sur « ok » du propriétaire, puis incrément suivant du backlog.

## 2026-11-05 22:34 — Incrément 12 démarré : #9 calendrier, Buffer, comptes sociaux

- PR #33 (#8 visuels) mergée en squash (`579f2eb`), branche distante supprimée. Branche de travail `feat/calendar-buffer` créée depuis `origin/main`.
- Découverte : Buffer = API GraphQL bêta `https://api.buffer.com` (Bearer, `createPost{text, channelId, schedulingType: automatic, mode: customScheduled, dueAt}` → `PostActionSuccess|MutationError`, pas de clé d'idempotence, 429 + Retry-After, permalink non documenté) ; l'ancienne REST ferme le 2027-02-01.
- Plan architecte retenu (copie complète : scratchpad de session `plan-inc12.md`) : outbox transactionnelle 3 phases (réserver `sending` → appel hors tx → enregistrer), tables `social_account` / `delivery` / `delivery_attempt` (migration 0007), adaptateur `integrations/buffer` derrière `Publisher` (`BUFFER_API_KEY` secret), moteur `src/publishing/{readiness,settle,dispatch}.ts`, cron Worker `*/5` + `POST /deliveries/dispatch`, routes comptes sociaux / livraisons / calendrier, web `/calendar`, section Publication sur la tâche, `/social-accounts` admin. Arbitrages pour l'ADR 0009 : canal strict (compte = canal de la version, zéro cross-post implicite) ; transition `scheduled→approved` quand toutes les livraisons sont annulées.
- Ordre : A schéma → B intégrations → C moteur → D RBAC/routes/contrats → cron → E web/e2e → ADR/PR. Rien d'implémenté encore.

## 2026-11-05 23:30 — Incrément 12 (#9) : calendrier, Buffer, comptes sociaux — prêt pour PR

- Branche `feat/calendar-buffer`. API : migration `0007_publishing.sql` (social_account, delivery, delivery_attempt), port `Publisher` + adaptateurs `mock`/`buffer`, outbox `publishing/dispatch.ts` (claim tx → appel hors tx → record tx, bail, réconciliation `lookup`, repli exponentiel ≤ 60 min, 5 tentatives), readiness 5 vérifications, routes `social-accounts`/`deliveries`/`calendar`, cron `*/5`, RBAC `social.*`/`delivery.dispatch`, transition `scheduled→approved`.
- Web : hooks `publishKeys`, `PublicationSection` sur la page tâche, `/calendar` (liste par jour, mois, filtre produit), `/social-accounts` (admin), liens tableau de bord. Mock e2e : option `publishable`, comptes et livraison seedés, routes publication, hook `/__test/fail-delivery`.
- Preuves : API tsc 0, vitest 113/113, wrangler dry-run OK, openapi:check et contracts check à jour ; web tsc 0, vite build OK, Playwright 86/86 (desktop + Pixel 7) après ajout d'un Tab pour « Calendrier » dans le test clavier.
- ADR 0009, `docs/operations.md` (BUFFER_API_KEY secret, vars Buffer/lead/cron). Reste : commit, push, PR « Closes #9 », CI, merge sur accord.
- À confirmer en passage `live` : contrat bêta Buffer (`shareNow`, deletePost, permalien) ; pas d'idempotence côté Buffer (doute → `failed` « vérification manuelle »).

## 2026-11-06 07:59 — PR #34 mergée, incrément 13 (#10 reporting) démarré

- PR #34 (#9 publication) mergée en squash (`39034c4`), branche distante supprimée, `main` à jour en local.
- Issues ouvertes restantes : #10 (reporting éditorial et SEO Monitor), #11 (notifications et exceptions), #15 (Project GitHub doublon, verrou propriétaire), #1/#2 (cadrage, à clôturer par le propriétaire).
- Incrément 13 = #10 : plan architecte demandé (scratchpad `plan-inc13.md`), puis API → contrats → web/e2e → ADR 0010 → PR « Closes #10 ». Enchaîner ensuite sur #11.
- Verrous inchangés : Neon/Hyperdrive (appfactory#185), compte Cloudflare, `APPFACTORY_RELEASE_TOKEN`, alignement SHA impact/release, rendu PNG.

## 2026-11-06 08:53 — Incrément 13 (#10 reporting) prêt à livrer

- Branche `feat/reporting`. API : migration `0008_reporting.sql` (contract_objective, metric_snapshot, index sent_at / transitions), `reporting/` (period, report, verified, refresh), port `MetricsProvider.verified`, adaptateur `http-json-metrics` (contrat `GET /v1/metrics?kind&ref`, bearer `METRICS_TOKEN`), routes `/reports/editorial`, `/reports/metrics/refresh` (409 `metrics-not-connected` en mock), `/products/{id}/objectives`, `/objectives/{id}`, `PATCH /products/{id}` (seoMonitorUrl), RBAC `report.read` / `objective.manage` / `metrics.refresh`.
- Web : hooks `reportKeys`, page `/reports` (mois UTC, filtre produit, comptages, objectifs admin, campagnes, articles, mesures vérifiées avec provenance, lien SEO Monitor, rafraîchissement admin), lien « Rapports » sur le tableau de bord. Mock e2e : option `metricsConnected`, routes reporting/objectifs/produits.
- Correctif mobile : `.stack > * { min-width: 0 }` + `.table-wrap` (overflow-x, focusable, région nommée) + `.kit-card { overflow-wrap: anywhere }` — les tableaux élargissaient la page à 668 px sur Pixel 7 et le tap sur « Rafraîchir » tombait sur une carte voisine.
- Preuves : API tsc 0, vitest 129/129, openapi:check et contracts check à jour, wrangler dry-run OK ; web tsc 0, vite build OK, Playwright 100/100 (desktop + Pixel 7).
- Docs : ADR 0010, `docs/operations.md` (METRICS_*), lessons-learned 004 (mock ≠ mesure) et 005 (tx PGlite). Reste : commit, push, PR « Closes #10 », CI, merge sur accord, puis #11.


## 2026-11-06 09:36 — PR #35 mergée, incrément 14 (#11 notifications) démarré

- PR #35 (#10 reporting) mergée en squash (`dcd9482`), branche distante supprimée, `main` à jour. Branche `feat/notifications` créée.
- Incrément 14 = #11 : plan architecte demandé (alertes dédupliquées dérivées des faits : tâches en retard / à corriger, approbation requise, publication échouée, import en erreur ; préférences par utilisateur ; envois via port Mailer avec retries audités ; page `/alerts` + badge tableau de bord). Puis API → contrats → web/e2e → ADR 0011 → PR « Closes #11 ».
- Verrous inchangés : Neon/Hyperdrive (appfactory#185), compte Cloudflare, `APPFACTORY_RELEASE_TOKEN`, alignement SHA impact/release, rendu PNG, contrat `http-json-metrics` à valider contre le SEO Monitor.

## 2026-11-06 09:42 — Plan #11 reçu (scratchpad plan-inc14.md)

- Décision : alertes = état dérivé, un seul écrivain `alerts/reconcile.ts` (inspecter → désiré → diff ; second passage = 0 écriture), kinds `task_blocked|content_fix|approval_required|publication_failed`, priorités p1/p2/p3 par `alerts/rules.ts` (seuils `ALERT_APPROVAL_HOURS` 24, `ALERT_STALL_HOURS` 72, `ALERT_DUE_SOON_HOURS` 24), une alerte tâche par tâche (précédence content_fix > approval_required > overdue > stalled), `publication_failed` par livraison failed, dédup par index partiel sur `dedup_key` (state <> resolved). Pas de résolution manuelle ; acquittement ; escalade rouvre et renvoie.
- E-mails : outbox at-most-once `notification_dispatch` (`alerts/notify.ts`, phases comme `publishing/dispatch.ts`, bail 5 min, backoff, 3 tentatives, audit `notification.send` sans adresse), port `Mailer` template `alert`, `WEB_APP_URL`. Préférences `notification_preference` (user, kind, email off|immediate ; défauts dans le code). Bootstrap silencieux (pas d e-mail au premier passage).
- Routes : `GET /alerts`, `POST /alerts/{id}/acknowledge`, `POST /alerts/reconcile` (admin), `GET/PATCH /me/notification-preferences` ; RBAC `alert.read|acknowledge|reconcile` ; cron : dispatch → alertes ; réconciliation ciblée best-effort après transitions/approbations/retry/cancel. Web : `/alerts` (filtres, acquitter, préférences, admin « Vérifier maintenant »), badge « Alertes » tableau de bord. Imports hors périmètre (pas de fait d erreur). ADR 0011, LESSON-006.

## 2026-11-06 10:10 — Incrément 14 (#11 alertes et notifications) prêt à livrer

- Branche `feat/notifications`. API : migration `0009_alerts_notifications.sql` (alert, notification_preference, notification_dispatch, index partiel dedup), `alerts/rules.ts` (4 kinds, précédence, priorités, seuils `ALERT_*`), `alerts/reconcile.ts` (seul écrivain, diff convergent, bootstrap silencieux, hooks ciblés dans tasks/deliveries), `alerts/notify.ts` (outbox at-most-once, bail, backoff, audit sans adresse), routes `/alerts`, `/alerts/{id}/acknowledge`, `/alerts/reconcile` (admin), `/me/notification-preferences` (GET/PATCH, `requireSession`), RBAC `alert.read|acknowledge|reconcile`, cron outbox → réconciliation → notifications, `WEB_APP_URL`.
- Web : `src/alerts.ts` (libellés), hooks `alertKeys`/`useAlerts`/`useAcknowledgeAlert`/`useReconcileAlerts`/préférences, page `/alerts` (filtres URL état/priorité/produit, lien tâche + `#publication`, Acquitter, « E-mail non remis », préférences repliables, admin « Vérifier maintenant »), lien « Alertes (n) » sur le tableau de bord (+1 Tab dans le test clavier), mock e2e (`seedAlerts`, routes alerts/preferences), `alerts.spec.ts` 7 scénarios + axe.
- Preuves : API tsc 0, vitest 146/146, openapi/contracts à jour, wrangler dry-run OK ; web tsc 0, vite build OK, Playwright 116/116 (desktop + Pixel 7).
- Docs : ADR 0011, lessons 006 (rien dérivé de « maintenant » dans un réconciliateur) et 007 (drizzle retire le qualificatif en sous-requête corrélée), `docs/operations.md` (ALERT_*, WEB_APP_URL, gates). Reste : commit, push, PR « Closes #11 », CI, merge sur accord. Issues restantes ensuite : #15 (verrou propriétaire), #1/#2 (cadrage).

## 2026-11-06 10:18 — Incrément 14 livré, clôture du backlog produit

- PR #36 (#11 alertes et notifications) mergée en squash sur `main` : `4db19b2`. CI verte (impact, contracts, api, web, visual-qa, mobile-android, mobile-ios).
- Issues #1 (Discovery) et #2 (Foundation) fermées avec commentaire de renvoi vers `docs/discovery.md`, ADR 0001–0011, `docs/architecture/target-architecture-draft.md`, `docs/operations.md`.
- #15 (Project doublon) : vérifié en lecture seule, #25 ⊂ #24 (7 items, tous Done, tous présents dans #24). Suppression laissée au propriétaire ; commentaire posté sur l'issue. Seule issue encore ouverte.
- Verrous propriétaire inchangés : Neon/Hyperdrive (appfactory#185), compte Cloudflare, `APPFACTORY_RELEASE_TOKEN`, suppression Project #25.
- Suites hors backlog : renderer PNG (ADR 0008), aligner impact/release sur le SHA du registry, confirmer le contrat Buffer beta et `http-json-metrics` au premier run réel.
- Prochaine étape : aucune issue produit en attente ; premier déploiement staging dès levée des verrous (`docs/operations.md` §6).

## 2026-11-06 10:27 — Test local sans déploiement

- Branche `fix/local-dev`. Le proxy Vite ne couvrait que 5 préfixes : les routes alerts, calendar, reports, brand-kits, deliveries, imports, objectives, social-accounts, visuals, visual-formats recevaient `index.html` en dev. Désormais dérivé de `packages/contracts/openapi.json` (plus de liste à maintenir).
- `services/api/scripts/bootstrap-local.sql` : premier admin + 3 produits, idempotent, couvert par `test/bootstrap-local.test.ts` (PGlite, rejoué deux fois).
- README « Tester l'application en local » : Neon dev branch → `.dev.vars` → `db:migrate` → `wrangler dev` + Vite → lien magique dans la console (`[mock-mailer]`) → bootstrap SQL.
- Reste : l'utilisateur crée la branche Neon et renseigne `.dev.vars` lui-même (jamais commis).

## 2026-11-06 10:31 — PR #38 en attente de CI (facturation Actions)

- PR #38 (`fix/local-dev`, tête `cfa8967`) : proxy Vite dérivé d'openapi.json, bootstrap SQL testé, README test local. Vérifications locales vertes (tsc web/api, vite build, test PGlite).
- CI bloquée : GitHub Actions refuse de démarrer les jobs (« recent account payments have failed or your spending limit needs to be increased »). Verrou propriétaire : Billing & plans de l'organisation Trigenys.
- Décision utilisateur : attendre la CI, ne pas merger sans. Prochaine étape : une fois la facturation réglée, relancer les checks (`gh pr checks 38 --watch`) puis merger en squash sur accord.

## 2026-11-06 13:02 — Dépôt public, exécution locale de l'app, correction des variables Hyperdrive

- Dépôt `Trigenys/trigenys-studio` passé en public pour débloquer GitHub Actions ; PR #37 et #38 fusionnées, CI verte.
- Application lancée en local et vérifiée dans le navigateur : connexion par magic link (lien lu dans la console du Worker, `[mock-mailer]`), rôle admin via `services/api/scripts/bootstrap-local.sql`, tableau de bord avec les trois produits.
- Base locale : conteneur Docker `trigenys-studio-pg` (postgres:16-alpine, port hôte `127.0.0.1:5434`, base `studio`), migrations appliquées avec psql car `drizzle-kit migrate` reste muet.
- Pièges rencontrés : wrangler 4 attend `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` **dans l'environnement du processus** (ignoré dans `.dev.vars`) ; `localhost` et un conteneur créé sans port publié actif font pendre la connexion → `127.0.0.1` + `?sslmode=disable` ; Vite tombé sur 5175 → origine ajoutée à `AUTH_TRUSTED_ORIGINS` dans `.dev.vars`.
- Branche `fix/local-dev-hyperdrive` : README et `.dev.vars.example` corrigés (variable, Docker, psql de secours). Config de lancement locale dans `.claude/launch.json` (non versionné).
- Verrous propriétaire inchangés : Neon/Hyperdrive de staging, compte Cloudflare, `APPFACTORY_RELEASE_TOKEN`, suppression du Project #25 (#15).

## 2026-11-06 13:31 — PR #39 fusionnée, app locale opérationnelle

- PR #39 fusionnée (squash, a2f28a9) : doc de lancement local corrigée (`CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` en variable d'environnement, Docker Postgres, repli psql) et test alertes ancré sur l'horloge réelle (LESSON-STUDIO-2026-008). Aucune PR ouverte, main à jour, CI verte.
- App locale : Docker `trigenys-studio-pg` (127.0.0.1:5434), Worker 8787, web 5175 (`.claude/launch.json`, non versionné) ; compte admin = adresse de l'utilisateur ; les variables locales sont dans `services/api/.dev.vars` (non commis).
- Suite API complète instable en parallèle localement (« PGlite is closed ») quand les serveurs dev tournent ; passe en série (`--no-file-parallelism`, 147/147).
- Prochaine étape : à la demande de l'utilisateur (tester l'app dans le navigateur, ou déploiement staging qui dépend des verrous propriétaire Neon/Cloudflare).

## 2026-11-06 14:00 — Retour utilisateur : interface jugée laide

- L'utilisateur juge l'UI web laide. Constat : aucun skill design (frontend-design, design-taste-frontend, high-end-visual-design, ux-ui-cx-excellence) n'a été invoqué lors des incréments web ; `apps/web/src/styles.css` (274 lignes) est un thème sombre générique (Inter, accent indigo, dégradés radiaux) sur 10 pages.
- Prochaine étape proposée : incrément « refonte visuelle » — audit UX/UI d'abord, direction de design assumée, refonte du système de styles et des pages, preuve Playwright, une PR. En attente du go de l'utilisateur.

## 2026-11-06 14:13 — Refonte visuelle web en cours (branche feat/web-visual-redesign)

- Direction retenue (skills design-taste-frontend + ux-ui-cx-excellence) : UI produit calme type Linear, police Geist (`@fontsource-variable/geist`), base neutre, un seul accent bleu, thème clair/sombre via `prefers-color-scheme`, rayons 6/8/12, navigation globale en barre latérale (≥ 900 px) et en-tête collant avec nav défilante (≤ 900 px).
- Fichiers : `apps/web/src/styles.css` réécrit ; `Shell.tsx` porte la navigation (compteur d'alertes, section Réglages admin) ; `Dashboard.tsx` n'a plus de liens de navigation ; tirets cadratins retirés des textes ; `index.html`, `favicon.svg`, deux specs e2e ajustées (ordre de tabulation, texte du lien Alertes).
- Piège : sur mobile, `.shell` (grille, min-height 100vh) répartissait l'espace libre entre l'en-tête et le contenu → en-tête de 197 px ; corrigé avec `grid-template-rows: auto 1fr` dans le bloc ≤ 900 px.
- État : build et e2e verts avant le correctif mobile, relance en cours ; reste à committer (sans `.claude/`), ouvrir la PR avec revue RAIDER et captures, attendre la CI, puis demander le go de fusion.

## 2026-11-06 14:25 — PR #40 ouverte : refonte visuelle du cockpit

- PR #40 (`feat/web-visual-redesign`, commit 1cadbcc) : refonte visuelle complète, preuves dans la PR (build, 98 e2e Playwright, captures). CI verte (contracts, visual-qa, impact, sync-project).
- En attente du go utilisateur pour fusion (`gh pr merge 40 --repo Trigenys/trigenys-studio --squash --delete-branch`).
- Serveurs locaux toujours lancés : Worker 8787, web 5175, Docker `trigenys-studio-pg`.

## 2026-11-06 14:50 — PR #40 : correctif accessibilité après CI rouge

- Le job `web` de la CI échouait (18 tests axe) : contraste des pastilles `warn`/`success` en clair et `aria-label` du lien Alertes différent du texte visible. Le vert local précédent venait d'un serveur Vite réutilisé sur le port 5190 (LESSON-STUDIO-2026-009).
- Correctifs : tokens `--warn` #854d0e / `--success` #166534 (clair), suffixe `visually-hidden` « à traiter » à la place de l'`aria-label`, helper axe qui affiche fg/bg/ratio. Suite complète : 116 tests verts, build vert.
- Prochaine étape : CI verte sur le nouveau commit, puis go utilisateur pour fusion en squash.

## 2026-11-06 16:17 — PR #40 : barre de filtres des alertes

- Retour utilisateur : les filtres État / Priorité / Produit de /alerts étaient empilés sans libellé.
- Correctif 64e19ec : wrapper `.filters` (flex, bordures haut/bas), `.filter-group` avec libellé visible `.filter-label` (aria-label conservé).
- Preuves : 116 e2e passés (port 5190 libre), `npm run build` vert, rendu vérifié dans le navigateur.
- En attente : CI sur 64e19ec puis accord utilisateur pour le squash merge de la PR #40.

## 2026-11-06 16:23 — Fusion de la PR #40 (refonte visuelle)

- PR #40 fusionnée en squash sur main (05a06e9), branche feat/web-visual-redesign supprimée. Local sur main à jour.
- Palette actuelle : neutre + accent bleu #2457d6 ; aucune charte Trigenys dans le dépôt (favicon placeholder).
- Prochaine étape : l'utilisateur fournit codes hex ou logo Trigenys → nouvelle branche `feat/web-brand-palette`, aligner accent/boutons/pastilles/favicon, vérifier contrastes AA clair + sombre, 116 e2e, PR distincte.

## 2026-11-06 16:29 — PR #41 palette Trigenys ouverte

- Branche `feat/web-brand-palette` (depuis main 6310a30), PR #41 : tokens clair/sombre alignés sur le design system V4 du Drive (bordeaux #7F2044, prune #55162F, turquoise #138F8D assombri en #0f6f6d pour AA, rose #E7A2B6, encre #251C2A, crème #FCFAFB), favicon + theme-color, « Studio » en accent.
- Preuves : 116 e2e verts (axe AA inclus), build OK, visuel clair/sombre vérifié.
- Prochaine étape : CI verte → attendre le « ok » de l'utilisateur pour squash-merge, puis entrée passation.

## 2026-11-06 16:50 — Fusion de la PR #41 (palette Trigenys)

- PR #41 fusionnée en squash sur main (0677cbf), branche feat/web-brand-palette supprimée. Local sur main à jour.
- Le web utilise désormais la palette du design system V4 (Drive) ; le bleu générique a disparu.
- Prochaine étape : attendre la prochaine consigne de l'utilisateur (pistes possibles : logo officiel SVG du pack V4 à la place du « T » du favicon, polices Urbanist / Plus Jakarta Sans du brand book à la place de Geist).

## 2026-11-07 04:11 — Serveur MCP (PR #42)

- Branche `feat/api-mcp-server`, PR #42 ouverte sur `main`, en attente de l'accord de merge (squash).
- `POST /mcp` : Streamable HTTP sans état (`@hono/mcp` 0.3.5 + SDK 1.32.2), 13 outils déclarés dans `services/api/src/mcp/tools.ts`, rejoués via `app.fetch` avec les en-têtes de l'appelant (parité RBAC/audit/idempotence). Hors contrat OpenAPI (`app.all`). ADR 0012.
- Preuves : typecheck 0, build dry-run OK, openapi:check identique à `main` (CRLF local seulement), `test/mcp.test.ts` 11/11 (dont client officiel du SDK).
- Point d'attention : la suite complète `npm test -w services/api` échoue localement par timeouts `beforeAll` PGlite sous charge parallèle, à l'identique sur `main` (préexistant). Piste : `hookTimeout` ou `fileParallelism` dans `vitest.config.ts`.

## 2026-11-07 04:20 — Fusion de la PR #42

- PR #42 (serveur MCP) fusionnée en squash sur `main` (83c60f1), branche supprimée. CI verte (api, contracts, web).
- Plan SEO reçu de la session expert-seo-geo : non applicable ici (insight.trigenys.com absent de ce dépôt), renvoyé à cette session.
- Prochaine étape : aucune en cours ; piste ouverte = fiabiliser la suite API locale (timeouts PGlite en parallèle, préexistants).

## 2026-11-09 08:31 — Assignation de tâches notifiée (PR #43)

- Branche `feat/assignation-notify`, PR #43 ouverte (CI en cours), non fusionnée : attend l'accord du commanditaire.
- Contenu : `GET /products/{id}/assignees`, notification `task_assigned` via l'outbox, `NotifyMailer` (route e-mail générique Trigenys Notify), outils MCP `list_assignees` / `create_task` / `assign_task`, vue web « Mes tâches », ADR 0013.
- Preuves locales : tsc API/web, lint, 168 tests (séquentiel), openapi/contracts à jour, dry-run wrangler, build web.
- Mise en service (après déploiement) : Studio `INTEGRATION_EMAIL_MODE=live`, `NOTIFY_EMAIL_BASE_URL`, secret `NOTIFY_EMAIL_INGEST_KEY` ; Notify `EMAIL_TRIGENYS_STUDIO_INGEST_KEY` + entrée `EMAIL_PROJECTS_JSON` ; rôle operator pour la prestataire sur ses produits.
- Suites : route WhatsApp générique côté trigenys-notify (session à part) ; OAuth 2.1 MCP pour les connecteurs distants ChatGPT / claude.ai ; verrous de déploiement inchangés (appfactory#185, compte Cloudflare, APPFACTORY_RELEASE_TOKEN).

## 2026-11-09 08:42 — Fusion de la PR #43

- PR #43 (assignation notifiée via Trigenys Notify) fusionnée en squash sur `main` (8510ca6), branche supprimée. CI verte après relance de mobile-ios (504 réseau sur setup-java, sans lien avec le code).
- Session liée en cours : route WhatsApp générique dans `Trigenys/trigenys-notify` (local_91df471b). Ensuite, ajouter le canal WhatsApp côté Studio dans une PR séparée.
- Verrous de déploiement inchangés : appfactory#185, compte Cloudflare, APPFACTORY_RELEASE_TOKEN. Suite possible : OAuth 2.1 sur le serveur MCP pour les connecteurs ChatGPT / claude.ai.

## 2026-11-19 08:39 — Fusion Notify #61 demandée, bloquée par un conflit

- Accord du commanditaire pour fusionner Trigenys/trigenys-notify#61 (route WhatsApp générique). CI verte, mais GitHub refuse : conflit avec main de Notify.
- Résolution confiée à la session Notify (local_91df471b) : mise à jour de la branche, tests, puis fusion en squash. Message en attente de prise en charge.
- Ensuite : canal WhatsApp côté Studio (PR séparée). Déploiement toujours bloqué par Trigenys/appfactory#185, le compte Cloudflare et APPFACTORY_RELEASE_TOKEN.

## 2026-11-19 08:44 — Notify #61 fusionnée

- Trigenys/trigenys-notify#61 (route WhatsApp générique par projet) fusionnée en squash (f794c02) après résolution du conflit par la session Notify ; CI verte.
- Prochaine étape : canal WhatsApp côté Studio (PR séparée), groupe « Studio Comm » à créer et déclarer côté Notify. Déploiement toujours bloqué par Trigenys/appfactory#185, le compte Cloudflare et APPFACTORY_RELEASE_TOKEN.

## 2026-11-19 09:01 — PR #44 canal WhatsApp Studio

- Trigenys/trigenys-studio#44 ouverte (branche feat/notify-whatsapp) : canal WhatsApp de groupe via la route générique Notify, opt-in `WHATSAPP_NOTIFY_EVENTS=task_assigned` + `INTEGRATION_WHATSAPP_MODE=live` + secret `NOTIFY_WHATSAPP_INGEST_KEY`. ADR 0014.
- Preuves : typecheck OK, 176 tests verts, build dry-run OK.
- Activation restante (sur accord) : groupe « Studio Comm » + id @g.us, clé partagée Notify/Studio, PR Notify activant trigenys-studio dans WHATSAPP_PROJECTS_JSON, vars Studio.

## 2026-11-19 09:02 — PR #44 fusionnée

- Trigenys/trigenys-studio#44 (canal WhatsApp de groupe, ADR 0014) fusionnée en squash (c7504f5), branche distante supprimée.
- Prochaine étape, sur accord : groupe « Studio Comm » + id @g.us, clé partagée Notify/Studio, PR Notify activant trigenys-studio dans WHATSAPP_PROJECTS_JSON, vars Studio (INTEGRATION_WHATSAPP_MODE=live, WHATSAPP_NOTIFY_EVENTS=task_assigned). Déploiement toujours bloqué par Trigenys/appfactory#185.

## 2026-11-19 09:06 — Activation WhatsApp : en attente du groupe

- Session WAHA de Notify sur le VPS : `trigenys-test` (conteneur trigenys-waha, port 3000), compte « Trigenys Group », WORKING. Aucun groupe « Studio Comm » n'existe encore.
- Bloquant : le propriétaire crée le groupe « Studio Comm » sur son téléphone et y ajoute le compte « Trigenys Group » et Tiffany. Ensuite : relever l'id @g.us (lecture WAHA), PR Notify (wrangler.production.jsonc, entrée trigenys-studio enabled + groupe).
- Limites : le Studio n'a pas encore d'origine HTTPS publique (AUTH_TRUSTED_ORIGINS = localhost), donc allowedLinkOrigins reste vide et aucun lien ne part ; secret Studio et test réel impossibles avant déploiement (Trigenys/appfactory#185).

## 2026-11-19 09:16 — Groupe WhatsApp créé, PR Notify #73

- Groupe réel : « Trigenys Comm » (120363414787082587@g.us, session trigenys-test, 3 membres, créé 2026-11-19 08:08 UTC).
- Trigenys/trigenys-notify#73 ouverte (worktree ../trigenys-notify-wa-studio, branche feat/whatsapp-studio-group) : entrée trigenys-studio activée, allowedLinkOrigins vide. Tests Notify 146/146, check backend OK.
- Restant : merge #73 ; clé partagée (WHATSAPP_TRIGENYS_STUDIO_INGEST_KEY côté Notify = NOTIFY_WHATSAPP_INGEST_KEY côté Studio) à poser par le propriétaire au déploiement du Studio ; vars Studio INTEGRATION_WHATSAPP_MODE=live, WHATSAPP_NOTIFY_EVENTS=task_assigned ; origine HTTPS du Studio à ajouter dans allowedLinkOrigins.

## 2026-11-19 09:22 — Clé WhatsApp partagée (en cours, côté propriétaire)

- Le secret Notify se pose depuis ../trigenys-notify-wa-studio : `npx wrangler secret put WHATSAPP_TRIGENYS_STUDIO_INGEST_KEY --config backend/wrangler.production.jsonc` (depuis le Studio : « Worker name missing »).
- Génération sous Windows PowerShell 5.1 : `RandomNumberGenerator::Fill` n'existe pas, utiliser `[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)`.
- Inchangé : merge Trigenys/trigenys-notify#73 en attente d'accord ; main du Studio (c4685ed, 5b5bbad) à pousser par le propriétaire ; vars Studio et allowedLinkOrigins au déploiement.

## 2026-11-19 09:27 — Clé WhatsApp posée côté Notify

- Secret WHATSAPP_TRIGENYS_STUDIO_INGEST_KEY posé sur le Worker trigenys-notify-staging-api (64 car., base64url, généré par script, jamais affiché ; présent dans `wrangler secret list`). Copie remise au propriétaire via le presse-papiers pour son gestionnaire de mots de passe.
- Reste : merge Trigenys/trigenys-notify#73 (accord du propriétaire) ; push de main du Studio ; au déploiement du Studio, même valeur en NOTIFY_WHATSAPP_INGEST_KEY + INTEGRATION_WHATSAPP_MODE=live + WHATSAPP_NOTIFY_EVENTS=task_assigned, origine HTTPS dans allowedLinkOrigins, test d'envoi.

## 2026-11-19 09:30 — PR Notify #73 fusionnée, déploiement Notify à faire

- Trigenys/trigenys-notify#73 fusionnée (3e7d09d). Le Worker n'est pas déployé automatiquement : dernier déploiement de code 2026-11-19 07:45 UTC (= #61), donc seul #73 manque.
- Déploiement refusé à l'agent (garde-fou prod) : le propriétaire lance depuis ../trigenys-notify-wa-studio, après `git fetch origin && git checkout --detach origin/main`, puis dans backend/ : `npx wrangler deploy --config wrangler.production.jsonc`.
- Ensuite : push de main du Studio ; au déploiement du Studio, NOTIFY_WHATSAPP_INGEST_KEY (même valeur), INTEGRATION_WHATSAPP_MODE=live, WHATSAPP_NOTIFY_EVENTS=task_assigned, origine HTTPS dans allowedLinkOrigins, test d'envoi.

## 2026-11-19 09:33 — Notify déployé avec le groupe Studio

- Worker trigenys-notify-staging-api déployé par le propriétaire depuis origin/main 3e7d09d (version c8eb1228-aa92-4b3d-b5e3-536f5dca8f38) ; WHATSAPP_PROJECTS_JSON contient trigenys-studio. Route /v1/dispatch/trigenys-studio/whatsapp sans clé → 401 UNAUTHORIZED.
- Côté Notify, tout est prêt. Le worktree ../trigenys-notify-wa-studio est en HEAD détachée sur origin/main (branche feat supprimée) : peut être retiré.
- Reste (Studio) : push de main ; au déploiement (bloqué par Trigenys/appfactory#185), NOTIFY_WHATSAPP_INGEST_KEY = valeur gardée par le propriétaire, INTEGRATION_WHATSAPP_MODE=live, WHATSAPP_NOTIFY_EVENTS=task_assigned, puis PR Notify pour l'origine HTTPS du Studio dans allowedLinkOrigins, et test d'une assignation.

## 2026-11-19 09:39 — Point d'étape après activation Notify

- Tout ce qui reste pour la prestataire (e-mail + WhatsApp réels) dépend du déploiement du Studio. Verrous : Trigenys/appfactory#185 (projectId/branchId Neon à fournir par le propriétaire), APPFACTORY_RELEASE_TOKEN. Le compte Cloudflare existe déjà (celui de Notify, account 28007ba3…) : à confirmer comme cible du Worker trigenys-studio-api.
- Autre chantier disponible sans déploiement : OAuth 2.1 sur le serveur MCP (connecteurs distants ChatGPT / claude.ai, ADR 0012).
- Choix demandé au propriétaire : débloquer le déploiement ou lancer l'OAuth MCP.

## 2026-11-19 10:06 — Base Neon de production via AppFactory (#185)

- Correction de l'entrée 09:39 : aucun identifiant Neon n'est à fournir. Le Studio suit le schéma Editorial OS : cible Neon **scellée** dans AppFactory (projet partagé `little-frog-93793324`, branche `br-twilight-star-b2orr8hw`, base `trigenys_studio`, rôle `trigenys_studio_owner`, créés au premier run), URL gardée en secret `HYPERDRIVE_DATABASE_URL__TRIGENYS_STUDIO_PRODUCTION` du Worker `appfactory-api`.
- AppFactory : PR Trigenys/appfactory#192 (branche `feat/neon-studio-target`, worktree `../appfactory-neon-studio`). tsc OK ; 231/236 tests, les 5 échecs existent déjà sur `origin/main`.
- Studio : workflow `.github/workflows/appfactory-infrastructure.yml` (OIDC → `/infrastructure/neon` → bail `/infrastructure/database-lease` → `drizzle-kit migrate`), `drizzle.config.ts` impose TLS `verify-full` (le bail retire `sslmode`). Tests API : 180/180 en série (en parallèle sous Windows, 6 fichiers tombent en timeout PGlite, déjà le cas avant).
- Ordre d'activation (propriétaire) : fusionner appfactory#192 et redéployer AppFactory ; fusionner la PR Studio ; `gh workflow run appfactory-infrastructure.yml -R Trigenys/trigenys-studio --ref main` ; attendre `PROVISIONED`, puis `ALREADY_CONFIGURED` au second run.
- Ensuite (phase B) : PR AppFactory U3 (rootDirectory `/services/api`, injection Hyperdrive dans `wrangler*.jsonc`), puis release du Worker, puis secrets e-mail/WhatsApp et test d'assignation.

## 2026-11-19 10:29 — Base de production provisionnée

- Fusionnées : Trigenys/appfactory#192 (Workers Builds appfactory-api vert) puis Trigenys/trigenys-studio#45.
- Workflow `appfactory-infrastructure.yml` : run push 44496548344 vert (base `trigenys_studio` + rôle créés, bail OIDC, `drizzle-kit migrate` : migrations appliquées) ; rerun dispatch 44496712033 vert (idempotent).
- Verrou suivant : phase B, PR AppFactory U3 (rootDirectory `/services/api` autorisé, injection de l'id Hyperdrive dans `wrangler*.jsonc`), puis release du Worker `trigenys-studio-api` ; ensuite secrets e-mail/WhatsApp et test d'assignation. Alternative sans déploiement : OAuth 2.1 MCP.
- Nettoyage possible : worktrees `../appfactory-neon-studio` et `../trigenys-notify-wa-studio`.

## 2026-11-19 10:58 — Phase B : release du Worker de production

- AppFactory U3 : Trigenys/appfactory#193 (racine `/services/api`, injection Hyperdrive JSONC), en attente de fusion.
- Branche `feat/production-worker-release` : job `worker` dans `appfactory-infrastructure.yml`, `.appfactory/worker.json`, `wrangler.production.jsonc` (id `appfactory-managed-hyperdrive`), secret généré `TRIGENYS_STUDIO_AUTH_SECRET`, script `check`, ADR 0015.
- Preuves locales : YAML + scripts `node --check` OK, `npm run check` OK, `test/auth-config.test.ts` 3/3, dry-run Wrangler avec injection Hyperdrive OK.
- Ordre : fusionner #193 (build appfactory-api vert) → fusionner la PR Studio → le workflow publie le Worker → vérifier `/health`. Ensuite secrets e-mail/WhatsApp + modes `live` + test d'assignation.

## 2026-11-19 13:08 — Release Worker : sonde de disponibilité

- Fusionnées : Trigenys/appfactory#193 (build appfactory-api vert) puis Trigenys/trigenys-studio#46.
- Run 44520132859 : job base vert ; job Worker déployé avec Hyperdrive mais bloqué `WORKER_DATABASE_NOT_READY` : la sonde AppFactory attend `database_configured` sur `/health`, sinon `GET /health/ready` avec `status: ready`. Studio n'avait pas cette route.
- Correctif : branche `fix/health-ready-probe` (`/health/ready` : ping base réel, 200 ready / 503 not_ready), contrat OpenAPI + client régénérés. Après fusion, le push relance le workflow (marqueurs présents → pas de ré-amorçage).
- Local `main` diverge d'origin (commit de passation e776437 jamais poussé) : à réaligner par l'utilisateur.

## 2026-11-19 13:36 — Worker de production prêt + état de la couverture

- Correction de l'entrée 13:08 : le push de #47 ne relance PAS le workflow (filtres `paths` limités aux migrations/infra) ; relance manuelle `gh workflow run appfactory-infrastructure.yml --ref main`.
- Run 44524985008 : jobs base + Worker verts. `GET /health/ready` en prod → 200 `{"status":"ready","database":"ok"}`. Intégrations toutes en `mock`.
- Couverture : API (47 chemins OpenAPI) et web (10 pages) couvrent les parcours discovery ; mobile = jour + tâche + connexion ; pas d'UI admin (rôles, règles/SLA, audit) ; web non déployée ; pas de R2 ; MCP sans OAuth.
- Prochaine étape (chemin Tiffany) : secrets Notify e-mail/WhatsApp sur le Worker, `INTEGRATION_EMAIL_MODE`/`INTEGRATION_WHATSAPP_MODE=live`, `WHATSAPP_NOTIFY_EVENTS=task_assigned`, allowedLinkOrigins côté Notify, assignation test.
- Toujours à faire par l'utilisateur : réaligner `main` local (e776437 non poussé), supprimer `feat/neon-production-database`.

## 2026-11-19 13:52 — Notifications en direct + web servie par le Worker

- Clés produit Notify posées en secrets (jamais affichées) : côté Notify `EMAIL_TRIGENYS_STUDIO_INGEST_KEY`, `WHATSAPP_TRIGENYS_STUDIO_INGEST_KEY` (régénérée) ; côté Studio `NOTIFY_EMAIL_INGEST_KEY`, `NOTIFY_WHATSAPP_INGEST_KEY`. Health 200 des deux Workers après pose.
- Trigenys/trigenys-notify#74 : `allowedLinkOrigins` Studio = origine du Worker Studio + projet e-mail `trigenys-studio`.
- Branche `feat/notifications-live` (ADR 0016) : web app servie par le Worker (binding `ASSETS`, aiguillage navigation/fetch dans `src/web/spa.ts`), `npm run check` construit la web, modes e-mail/WhatsApp `live`, `WEB_APP_URL`/`AUTH_TRUSTED_ORIGINS` = origine du Worker.
- Piège : le repli SPA natif Cloudflare renvoie `index.html` à un `fetch('/tasks/…')` (chemins partagés web/API) → aiguillage dans le Worker.
- Après merge des deux PR : `gh workflow run appfactory-infrastructure.yml --ref main`, puis assignation test (1 WhatsApp groupe « Trigenys Comm » + 1 e-mail).

## 2026-11-19 14:39 — Release Worker : correctif du build web

- Fusionnées : Trigenys/trigenys-notify#74 (Workers Build vert), #48 (web servie par le Worker, notifications en direct), #49 (correctif).
- #48 : release du Worker en échec (`CLOUDFLARE_WORKERS_BUILD_FAILED`, runs 44534058093 / 44534087291) : la recette n'installe que `services/api`, `build:web` manquait des dépendances de `apps/web`. #49 : `build:web` installe d'abord le workspace web (LESSON-STUDIO-2026-010).
- Run dispatch 44535574464 sur 8e3656b : vert (base + release Worker). Le push de #49 ne déclenche pas le workflow (`package.json` hors filtres).
- Prod vérifiée 14:43 : navigation `/` et `/tasks/x` → HTML Studio ; fetch `/tasks/x` → 401 problem+json ; `/health` email/whatsapp `live` ; `/health/ready` 200 ; Notify `/health` 200.
- Ensuite : test d'assignation : connexion de l'utilisateur par lien magique, `bootstrap-local.sql` dans la console Neon, connexion de Tiffany, rôle `operator` via `POST /roles`, assignation d'une tâche → e-mail + message « Trigenys Comm » (cron `*/5`).
- Sous Windows, `openapi:check` peut signaler un faux écart (CRLF) : vérifier avec `git diff --ignore-cr-at-eol`.

## 2026-11-19 15:18 — Lien de connexion : deux causes en production

- Symptôme : « Envoi impossible » sur /login (HTTP 500 sur `/api/auth/sign-in/magic-link`).
- Cause 1, corrigée par #51 (504cf90, run 44540463496 vert) : le `fetch` global rangé sur l'adaptateur lève « Illegal invocation » sur Workers → `defaultFetch` (LESSON-STUDIO-2026-011).
- Cause 2, PR #52 ouverte : Studio → Notify, deux Workers `workers.dev` du même compte, `fetch` refusé (404, erreur 1042) → drapeau `global_fetch_strictly_public` (LESSON-STUDIO-2026-012). Le merge déclenche seul le workflow infra (fichier `wrangler.production.jsonc`).
- Après déploiement de #52 : refaire `POST /api/auth/sign-in/magic-link` (attendu 200), puis connexion utilisatrice, puis assignation test.
- Main local diverge d'origin/main : travailler sur des branches tirées d'`origin/main`.

## 2026-11-19 15:22 — Lien de connexion rétabli en production

- #52 fusionnée (596f1c3), run infra 44542428321 vert (base + release Worker).
- `POST /api/auth/sign-in/magic-link` → 200 `{"status":true}` ; health 200. Un e-mail réel est parti vers l'adresse de l'utilisatrice.
- Prochaine étape : connexion de l'utilisatrice, `bootstrap-local.sql` avec son e-mail (console Neon), connexion de Tiffany, rôle `operator` (`POST /roles`), assignation test → e-mail + WhatsApp (cron 5 min).
- PR #50 (passation) toujours ouverte, à fusionner.

## 2026-11-19 15:31 — Premier admin en production (PR #53)

- Lien magique OK en prod ; le compte connecté n'a aucun rôle (Forbidden). Le premier admin ne passe pas par l'API, et seul `appfactory-infrastructure.yml` obtient la base (liste blanche OIDC AppFactory, `src/auth.ts` `authorizeDatabaseLeaseClaims`).
- PR #53 : entrée `admin_email` sur le dispatch du workflow → `npm run db:bootstrap-admin` (admin + 3 produits, idempotent, audit `admin.bootstrap`).
- Après merge : `gh workflow run appfactory-infrastructure.yml --ref main -f admin_email=<e-mail>`, puis recharger /today.
- Ensuite : gabarit HTML des e-mails (Adapt de roadmapmentor `server/services/emailLayout.ts`), Tiffany `operator`, assignation test.

## 2026-11-19 15:38 — Bootstrap admin : #53 mergée, échec TLS, correctif #54 ouvert

- #53 mergée (1d10457). Dispatch 44545011912 avec `admin_email` : migrations OK, bootstrap KO (URL du bail sans `sslmode` → connexion en clair refusée). Aucune écriture.
- PR #54 (ouverte, non mergée) : script via `migrationCredentials` (TLS), code SQLSTATE en erreur, garde-fou test, LESSON-STUDIO-2026-013.
- Prochaine étape : merger #54 (accord explicite requis), puis `gh workflow run appfactory-infrastructure.yml --ref main -f admin_email=jennifer@trigenys.com`, vérifier le job, recharger /today.
- Ensuite : gabarit HTML des e-mails, Tiffany `operator`, assignation test.

## 2026-11-19 15:53 — Premier admin en production : fait

- #54 mergée. Run 44548071813 (dispatch `admin_email`) vert : « role granted, products created: 3 » ; release Worker verte.
- Prochaine étape : gabarit HTML des e-mails (Adapt de roadmapmentor `server/services/emailLayout.ts`), puis Tiffany `operator` via `POST /roles`, assignation test (e-mail + WhatsApp « Trigenys Comm »).
- PR #50 (passation) toujours ouverte.

## 2026-11-19 17:01 — E-mails HTML aux couleurs du Studio (PR #55)

- #55 mergée (8535ce3) : `services/api/src/email/layout.ts` (gabarit adapté de roadmapmentor, styles inline, accent #7f2044) + `templates.ts` (lien magique, tâche assignée, alerte → sujet/texte/HTML). `Mail.html` optionnel ; l'adaptateur Notify garde `toHtml(text)` en repli. 205 tests verts.
- Déploiement : dispatch `appfactory-infrastructure.yml --ref main`, run 44561237371 (résultat à vérifier).
- Prochaine étape : connexion de Tiffany, rôle `operator` (`POST /roles`), assignation test → e-mail HTML + WhatsApp « Trigenys Comm » (cron 5 min).
- PR #50 (passation) toujours ouverte.

## 2026-11-19 17:51 — README production API/MCP (PR #56)

- Run 44561237371 vert : e-mails HTML en production.
- Vérifié en direct : `/health?deep=true` 200, `/openapi.json` 200, `/me` et `/mcp` 401 sans jeton.
- #56 mergée (2e339c3) : section README « Production : web, API et MCP » (origine unique, jeton `session.token` en Bearer 30 j, `claude mcp add --transport http`, 16 outils, octroi de rôle via `/me` → `POST /roles`).
- Limites connues : pas d'OAuth 2.1 MCP (connecteurs claude.ai), pas d'écran admin rôles/utilisateurs (pistes : `POST /roles` par e-mail).
- Prochaine étape inchangée : Tiffany se connecte, envoie son `userId` (`/me`), rôle `operator`, assignation test.
- PR #50 (passation) toujours ouverte ; `main` local en retard, à réaligner.

## 2026-11-19 18:53 — Identité commune : bascule vers trigenys-auth

- Décision utilisateur : l'équipe (e-mail, téléphone) n'est saisie qu'une fois, dans `Trigenys/trigenys-auth` (OIDC/OAuth 2.1), pas dans la SQLite de Sign (qui mélange équipe et signataires externes).
- Session dédiée « Déployer trigenys-auth et y reprendre l'équipe » (local_2a1ff2a9-…) : Trigenys/trigenys-auth#9 (import d'équipe idempotent, CLI migrate, clients OAuth `trigenys-studio`/`trigenys-sign`, port 8793). DNS `auth.trigenys.com` chez Spaceship à pointer sur 15.235.90.215 ; déploiement VPS sur accord explicite. Question en cours : connexion par lien magique au lieu du mot de passe dans trigenys-auth.
- Côté Studio, à faire après : Studio client OIDC de trigenys-auth (rôles via claim `roles`), OAuth 2.1 du MCP adossé à trigenys-auth ; l'octroi de rôle par e-mail est mis en attente.
- Tiffany : en attente de trigenys-auth.

## 2026-11-20 05:33 — MCP OAuth 2.1 adossé à trigenys-auth (plan)

- trigenys-auth en prod (issuer `https://auth.trigenys.com`, RFC 8414 et OIDC discovery 200, PKCE S256, pas de DCR). Client public `trigenys-studio` déclaré (redirect claude.ai, resource `…workers.dev/mcp`, rôles admin/operator/reviewer).
- Plan retenu (architecte) : `/mcp` = ressource OAuth (PRM RFC 9728, 401 `WWW-Authenticate`), validation JWT `at+jwt` via `jose` (JWKS en cache), liaison `account(providerId=trigenys-auth, accountId=sub)`, rôles du jeton copiés dans `role_assignment` avec `source='idp'` (globaux), bearer Better Auth inchangé. Fonction inactive tant que `OIDC_ISSUER` est vide.
- Verrou : restreindre aux orgs autorisées (`OIDC_ORGS`), sinon un membre d'une autre org deviendrait operator.
- Ensuite : API annuaire dans trigenys-auth + sync (assignable avant 1re connexion), puis connexion web via `genericOAuth`.
- Branche d'implémentation : `feat/mcp-oauth-trigenys-auth` depuis origin/main.

## 2026-11-20 05:44 — MCP OAuth 2.1 via trigenys-auth (PR #58 ouverte)

- Branche `feat/mcp-oauth-trigenys-auth`, PR https://github.com/Trigenys/trigenys-studio/pull/58 (3 commits) : vérificateur JWT `at+jwt` (jose, `src/auth/oidc.ts`), liaison sub → utilisateur par e-mail vérifié + réconciliation des rôles `source=idp` (`src/auth/identity.ts`, migration 0011), PRM `/.well-known/oauth-protected-resource[/mcp]`, 401 `resource_metadata`, 409 sur révocation d'un rôle idp.
- Prod : vars `OIDC_ISSUER=https://auth.trigenys.com`, `OIDC_RESOURCE=…/mcp`, `OIDC_ORGS=trigenys`, `OIDC_APP=trigenys-studio` dans `wrangler.production.jsonc` (actif dès le déploiement suivant la fusion).
- Preuve locale : 220 tests verts (dont 14 dans `test/oidc.test.ts`), typecheck + build des workspaces, `openapi:check` OK.
- Après fusion : `gh workflow run appfactory-infrastructure.yml --ref main`, puis connecteur claude.ai (URL `/mcp`, Client ID `trigenys-studio`, secret vide) ; vérifier `GET /.well-known/oauth-protected-resource/mcp`.
- Suites : API annuaire dans trigenys-auth + synchro Studio (cron), connexion web via genericOAuth, affectation test à Tiffany. PR #50 (passation) toujours ouverte.

## 2026-11-20 06:39 — PR #58 fusionnée, déploiement en attente

- #58 fusionnée sur main (92157e3, squash, branche supprimée). OAuth MCP via trigenys-auth actif dès le prochain déploiement.
- Déploiement non lancé : `gh workflow run appfactory-infrastructure.yml --repo Trigenys/trigenys-studio --ref main` attend l'accord explicite de l'utilisateur.
- Après déploiement : vérifier `GET /.well-known/oauth-protected-resource/mcp` (200, issuer auth.trigenys.com) et `POST /mcp` sans jeton (401 + resource_metadata), puis connecteur claude.ai (Client ID `trigenys-studio`, secret vide).

## 2026-11-20 07:09 — MCP OAuth via trigenys-auth déployé en production

- Run appfactory-infrastructure 44683914459 (92157e3) : migrations Neon (0011) + Worker OK.
- Prod vérifiée : PRM `/.well-known/oauth-protected-resource/mcp` 200 (authorization_servers auth.trigenys.com) ; `POST /mcp` sans jeton → 401 `resource_metadata` ; JWT forgé → 401 `error="invalid_token"` (découverte + JWKS de trigenys-auth joignables, pas de 503).
- Reste : test réel du connecteur claude.ai (URL `/mcp`, Client ID `trigenys-studio`, secret vide) par l'utilisateur ; puis API annuaire trigenys-auth + synchro, connexion web genericOAuth, affectation test à Tiffany. PR #50 ouverte.

## 2026-11-20 08:30 — Connecteur claude.ai validé, ChatGPT à préparer

- Connecteur MCP Studio ajouté dans claude.ai (client `trigenys-studio`, connexion Trigenys Auth) : appel `list_tasks` authentifié OK (liste vide).
- ChatGPT : trigenys-auth annonce `authorization_response_iss_parameter_supported: true` → ChatGPT utilisera l'URI stable `https://chatgpt.com/connector_platform_oauth_redirect`. DCR désactivé (`allowDynamicClientRegistration: false`) → client statique.
- Prochaine étape (sur accord) : PR trigenys-auth ajoutant cette URI à `redirectUris` du client `trigenys-studio` dans `deploy/clients.production.json`, puis déploiement trigenys-auth ; côté ChatGPT : mode développeur, URL `…/mcp`, OAuth, Client ID `trigenys-studio`, secret vide.
- Écran « Soumissions » (Pack de plug-ins / Connecteur MCP) de l'app Claude = publication dans un annuaire : inutile ici.

## 2026-11-20 08:32 — PR ChatGPT ouverte dans trigenys-auth

- Trigenys/trigenys-auth#17 (branche `feat/chatgpt-redirect-uri`) : URI `https://chatgpt.com/connector_platform_oauth_redirect` ajoutée au client `trigenys-studio` + test `test/production-clients.test.ts` (fichier prod validé avec les règles de production). `npm run check` : 67/67.
- Verrous : fusion sur accord explicite ; déploiement = VPS (git archive + `docker compose up -d auth`), sur accord explicite uniquement.
- Ensuite côté ChatGPT : mode développeur, URL `…/mcp`, OAuth, Client ID `trigenys-studio`, secret vide.

## 2026-11-20 08:41 — trigenys-auth 32c2805 déployé (connecteur ChatGPT)

- Trigenys/trigenys-auth#17 fusionnée (32c2805), envoyée sur le VPS par `git archive`, image reconstruite. Piège : `docker compose up -d auth` n'a pas recréé le conteneur malgré la nouvelle image → `up -d --no-deps --force-recreate auth` (contrôler l'ID d'image du conteneur après un déploiement).
- Log : `clients.reconciled` updated=[trigenys-studio], unchanged=[trigenys-sign] ; conteneur healthy.
- Preuve : authorize avec `redirect_uri=https://chatgpt.com/connector_platform_oauth_redirect` → 302 vers /login ; URI inconnue → `invalid_redirect`.
- Reste : test réel côté ChatGPT par l'utilisateur (mode développeur, URL `…/mcp`, OAuth, Client ID `trigenys-studio`, secret vide).

## 2026-11-20 08:42 — Procédure de déploiement trigenys-auth corrigée (PR ouverte)

- Trigenys/trigenys-auth#18 (`docs/deploy-force-recreate`) : `deploy/README.md` impose `up -d --no-deps --force-recreate auth` + contrôle d'ID d'image (doit afficher OK) ; leçon ajoutée dans `docs/engineering/lessons-learned.md`. Docs seulement.
- Verrou : fusion sur accord explicite. Reste aussi : test ChatGPT réel par l'utilisateur.

## 2026-11-20 09:03 — trigenys-auth#18 fusionnée

- dd4ab4f sur main de trigenys-auth : procédure de déploiement avec `--force-recreate` + contrôle d'image. Docs seulement, pas de redéploiement nécessaire (VPS sur 32c2805).
- Reste : test ChatGPT réel par l'utilisateur ; ensuite API annuaire trigenys-auth (client_credentials) puis sync Studio.

## 2026-11-20 09:27 — Connecteur ChatGPT : description et icône

- Serveur prêt (trigenys-auth 32c2805 déployé, URI `https://chatgpt.com/connector_platform_oauth_redirect` acceptée). L'utilisateur crée le connecteur sur chatgpt.com/plugins : URL `/mcp` du Worker, OAuth, Client ID `trigenys-studio`, sans secret.
- Icône retenue : hélice binaire Trigenys (motif du logo groupe et de l'icône Auth) en bits « 1 »/« 0 » sarcelle et rose sur le bordeaux Studio. Fichiers `~/Downloads/trigenys-studio-icon-helice.{png,svg}` (512×512), hors dépôt.
- Prochaine étape : résultat du test ChatGPT ; si l'URI de retour affichée diffère, l'ajouter dans `trigenys-auth/deploy/clients.production.json` (PR + déploiement sur accord).

## 2026-11-20 09:53 — Connecteur ChatGPT : 403 du garde d'origine MCP
- OAuth ChatGPT OK côté trigenys-auth (jetons émis, bonne ressource, même utilisateur que Claude) ; échec à l'appel /mcp.
- Cause probable : ChatGPT envoie `Origin: https://chatgpt.com` ; `mcpOriginGuard` refusait (403) toute origine hors AUTH_TRUSTED_ORIGINS.
- PR #59 (fix/mcp-bearer-origin) : JWT Trigenys Auth sans cookie exempté du contrôle d'origine ; cookie / session Better Auth toujours contrôlés. check 0, 221/221 en série.
- 4 tests échouent en parallèle (timeouts PGlite) aussi sur main : préexistant, charge machine.
- Reste : fusion + déploiement (accord requis), puis relancer la connexion dans ChatGPT.

## 2026-11-20 09:59 — PR #59 fusionnée et déployée
- #59 squash-mergée (18842e8), run appfactory-infrastructure 44706588384 : succès (Neon + Worker).
- Contrôle prod : /mcp anonyme avec Origin chatgpt.com -> 401 (attendu), PRM -> 200.
- wrangler tail filtré en cours (scratchpad tail.log) pour voir l'appel ChatGPT authentifié.
- Prochaine étape : l'utilisateur relance la connexion dans ChatGPT ; attendu : POST /mcp 200 avec origin=chatgpt.com auth=yes. Si échec, lire tail.log (statut, méthode GET/POST).

## 2026-11-20 10:04 — ChatGPT : « This account is already connected »
- Après #59 : ChatGPT obtient des jetons (09:02:48 et 09:02:59 UTC) pour le compte Trigenys PlHHV6 (@trigenys.com, même que Claude) mais n'appelle pas /mcp.
- Message ChatGPT « This account is already connected » : une connexion existe déjà côté ChatGPT (tentatives de 08:34/08:38) ; ChatGPT refuse le doublon avant tout appel MCP.
- Action utilisateur : ChatGPT → Paramètres → Applications → Trigenys Studio → déconnecter, puis reconnecter.
- wrangler tail élargi à toutes les routes (scratchpad tail.log) pour voir le premier appel après reconnexion.
