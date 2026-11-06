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
