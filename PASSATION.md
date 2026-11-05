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
