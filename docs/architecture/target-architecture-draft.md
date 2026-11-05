# Trigenys Studio — architecture cible (brouillon)

> Brouillon issu de la phase de conception, 2026-11-05. À formaliser en ADR 0001–0004 (issue #2).

## Décisions

- **A. Clients** : web React/Vite (existant, cockpit complet) + Kotlin/Compose Multiplatform pour Android et iOS (module `shared` commun). Périmètre mobile restreint : Ma journée, À valider, approuver/rejeter, notifications push, consultation de tâche. Compose for Web (Wasm) écarté (Beta, accessibilité canvas). Trois apps natives écartées (un seul dev). Expo/RN écarté (non natif, non supporté AppFactory).
- **B. Backend** : Cloudflare Worker `trigenys-studio-api` (Hono + `@hono/zod-openapi`, Drizzle, postgres.js via Hyperdrive) → Neon Postgres. Queues (outbox intégrations), Cron (sync métriques), R2 (visuels). Contrat OpenAPI 3.1 commité dans `packages/contracts/openapi.json` avec contrôle de dérive CI ; clients générés TS (`openapi-fetch`) et Kotlin (`openapi-generator` multiplatform/Ktor). Auth Better Auth (passkey + magic link, bearer pour mobile). RBAC `role_assignment(user, role ∈ {admin, operator, reviewer}, product?)`, politiques déclaratives. Audit `audit_event` en ajout seul, écrit dans la même transaction, rôle DB sans UPDATE/DELETE dessus. Transitions de pipeline décidées côté serveur (`allowedTransitions`).
- **C. Topologie** : monorepo `trigenys-studio` — `apps/web`, `apps/mobile` (`shared/`, `androidApp/`, `iosApp/`), `services/api`, `packages/contracts`, `docs/adr`. Respecte la convention Neon `<repo>-api`, un seul board, impact-aware CI, contrats modifiés atomiquement. Release Please en mode manifest.
- **D. Contributions amont** (une PR par sujet, LESSON-2026-002) :

| # | Dépôt | Sujet | Bloquant |
|---|---|---|---|
| U1 | appfactory | `trigenys-studio` dans `APPFACTORY_NEON_TARGETS` | Incrément 2 |
| U2 | appfactory | Matérialisation blueprint dans un sous-chemin (monorepo) | Non |
| U3 | appfactory | Variante `typescript-api` Worker (Hono+Drizzle+Hyperdrive) | Non (Studio = pilote) |
| U4 | appfactory | Blueprint mobile `platform: kmp` | Incrément 6 ou pilote dans Studio |
| U5 | project-automation | `reusable-mobile-release-android.yml` (AAB signé, piste interne) | 1re distribution Android |
| U6 | project-automation | `reusable-mobile-release-ios.yml` (TestFlight) | 1re distribution iOS |
| U7 | project-automation | Support manifest monorepo dans `reusable-release.yml` | Incrément 1 si absent |
| U8 | appfactory | Contrôle de dérive OpenAPI + génération clients réutilisable | Non |

## Schéma

```
 [Web React/Vite]   [Android CMP]   [iOS CMP]     <- clients générés depuis packages/contracts
        \                |             /
         HTTPS  (cookie web | bearer mobile)
                         v
        Cloudflare Worker trigenys-studio-api (Hono)
        |- Better Auth (passkey, magic link) -> email (adaptateur)
        |- RBAC middleware + audit transactionnel
        |- Machine d'états du pipeline + Idempotency-Key
        |- Outbox -> CF Queues -> adaptateurs (interface + mock + réel)
        |      CMS Insight | Editorial OS | Pipeline visuel (R2) | Buffer | SEO Monitor | LLM (AI Gateway)
        |- Cron : sync métriques, relances, échéances
        |- Push : FCM / APNs
                         v
                Hyperdrive -> Neon Postgres (branches dev/preview, prod)
 CI/CD : impact-analysis -> gates {web, api, contracts, android, ios}
   web : typecheck/build/visual-qa -> déploiement
   api : tests + migrations Drizzle via database-lease OIDC -> wrangler deploy
   android : Gradle/Roborazzi (ubuntu) ; ios : xcodebuild (macOS, gardé par l'impact)
   release-please (manifest) ; project-automation ; governance plan/apply
```

Adaptateurs choisis par configuration (`INTEGRATION_<X>_MODE=mock|live`), mocks par défaut.

## Modèle de données MVP

- Identité : `user`, `session`, `passkey`, `verification` ; `role_assignment`.
- Produits : `product` → `brand_kit` ; `social_account(product, network, buffer_profile_id, handle, active)`.
- Éditorial : `editorial_dossier(product, thème, angle, statut)` 1–N `source(origin ∈ radar|cms|manuel, url, external_ref)`.
- Tâches : `task(product, dossier?, type, titre, state, priority, due_at, assignee, version)` ; `brief` ; `content_version(task, n, body, channel, content_hash, ai_assisted, author)` ; `comment`.
- Pipeline : `pipeline_definition` (déclaratif JSON) ; `task_transition(task, from, to, actor, reason, idempotency_key UNIQUE)`.
- Validation : `approval(task, content_version_id, content_hash, asset_set_hash, approver, decision, comment)` — publication exige une approbation dont les hashes correspondent à l'état courant.
- Visuels : `asset` 1–N `asset_variant(format, w×h, r2_key, job_id, status)`.
- Livraison : `deliverable(task, social_account, content_version_id, variants[], scheduled_at, buffer_post_id, status)`.
- Mesure : `metric_snapshot(deliverable|url, provider, measured_at, metrics jsonb)`.
- Intégration : `outbox_job(kind, payload, idempotency_key UNIQUE, status, attempts, last_error)` ; `external_ref(provider, external_id, entity_type, entity_id)` UNIQUE(provider, external_id).
- IA : `ai_interaction(task, step, model, context_refs, tokens, output_version_id?)`.
- Transverse : `audit_event` (append-only) ; `idempotency_key` ; `notification` ; `device_token`.
- États tâche : À qualifier → En préparation → En relecture → Visuels → À valider → Approuvé → Programmé → Publié → Mesuré (+ Rejeté/À corriger, Échec).

## Plan de livraison

| Inc. | Issues | Contenu | Prérequis externe | Preuve |
|---|---|---|---|---|
| 0 | #15, #1 | Réconcilier Projects #24/#25 (plan→apply) ; `docs/discovery.md` | — | un seul Project lié |
| 1 | #2a | ADR 0001–0004, monorepo (`apps/web`), `appfactory-impact.json`, Release Please manifest ; ouvrir U1/U2/U7 | — | CI verte, impact testé sur 3 diffs |
| 2 | #2b | `services/api` Worker Hono, `/health`, OpenAPI, client TS, contrats d'intégration + mocks | U1, Neon project id, compte Cloudflare, domaine API | migration vide sous bail OIDC, preview déployée |
| 3 | #3 | Better Auth, RBAC, audit | domaine RP ID, DNS email (SPF/DKIM) | tests 401/403 par route, « publish sans approbation = 403 » |
| 4 | #5 | schéma Drizzle, machine d'états, Idempotency-Key, approbation liée aux hashes | — | tests transitions, double POST sans doublon |
| 5 | #4 | shell web Ma journée | — | Playwright clavier + mobile, axe-core, visual-qa |
| 6 | mobile Android | `apps/mobile` CMP, client Kotlin, magic link deep link, À valider | — | Roborazzi + intégration API preview |
| 7 | mobile iOS | `iosApp` | Apple Developer (99 $/an), runner macOS, AASA | build simulateur CI |
| 8 | #6 | dossiers + assistant IA (adaptateur LLM) | clé LLM (mock avant) | `ai_interaction` audité |
| 9 | #7 | adaptateurs CMS Insight, Editorial OS | contrats/accès (mock avant) | import rejoué 2× sans doublon |
| 10 | #8 | pipeline visuel, brand kits, R2 | contrat moteur visuel | variantes via outbox, reprise après échec |
| 11 | #9 | calendrier, Buffer, comptes sociaux | accès API Buffer (vérifier dès inc. 0) | planification refusée hors Approuvé, retry sans double post |
| 12 | #10, #11 | reporting SEO Monitor, notifications push | Firebase FCM, clé APNs | — |
| 13 | #12 | durcissement sécurité, U5/U6, Play interne + TestFlight | Play Console, keystore, clé App Store Connect | — |

## Risques

1. Accès API Buffer incertain → vérifier dès inc. 0 ; interface `Scheduler` avec repli (publication native / export).
2. Un seul dev sur 3 plateformes → périmètre mobile figé, logique dans `shared`, règles serveur, iOS après Android.
3. Better Auth / postgres.js / Hyperdrive sur Workers → spike inc. 2 ; plan B Auth.js ou maison, mêmes tables.
4. Intégrité des validations → approbation liée aux hashes, revérifiée dans l'outbox avant Buffer ; test dédié #5.
5. CI iOS coûteuse/fragile → gate d'impact, simulateur en PR, signature/TestFlight uniquement en release (U6).
