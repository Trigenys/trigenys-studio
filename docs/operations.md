# Exploitation — environnements, secrets, livraison

Runbook du MVP (issue #12). Il complète `README.md` (développement local) et les ADR. Règle de
fond : **aucun déploiement payant ni connexion à un compte externe sans validation humaine
explicite**, et **aucune release sans revue**.

## 1. Environnements

| Environnement | Web | API | Base | Qui déclenche |
|---|---|---|---|---|
| `local` | Vite `localhost:5173` | `wrangler dev` `localhost:8787` | branche Neon de dev (`.dev.vars`) | chaque développeur |
| `staging` | Cloudflare Pages (preview) | Worker `trigenys-studio-api-staging` | branche Neon `staging` | CI après merge sur `main`, **non activé** |
| `production` | Cloudflare Pages | Worker `trigenys-studio-api` | branche Neon `main` | release approuvée, **non activé** |

État : seuls `local` et la CI existent. `staging` et `production` attendent la contribution
AppFactory U1 (`appfactory#185`, Neon + Hyperdrive) et un compte Cloudflare validé par le
propriétaire. Tant que ces prérequis manquent, le pipeline s'arrête au build (`wrangler deploy
--dry-run`, `vite build`, `assembleDebug`) : rien n'est publié.

Règle **staging avant tout déploiement** : un changement n'atteint `production` qu'après avoir
tourné sur `staging` avec la même révision (`GITHUB_SHA`) et le même artefact. Les deux cibles
sont des *GitHub Environments* (`staging`, `production`) ; `production` porte des *required
reviewers* et le job de déploiement y reste bloqué tant qu'un humain n'approuve pas.

## 2. Configuration et secrets

### Principes
- Configuration non secrète versionnée : `services/api/wrangler.jsonc` (`vars`), `VITE_API_URL`,
  `studioApiUrl` (mobile, `-PstudioApiUrl=`). Les valeurs diffèrent par environnement, jamais
  par branche de code.
- Secrets : jamais dans le dépôt, jamais dans les logs, jamais dans une URL. Ils vivent dans
  les *Worker secrets* Cloudflare (`wrangler secret put`), les *GitHub Environment secrets* et,
  en local, dans `services/api/.dev.vars` (ignoré par Git ; modèle : `.dev.vars.example`).
- Moindre privilège : la CI tourne en `contents: read` ; seul `release.yml` écrit (PR et tags)
  avec `APPFACTORY_RELEASE_TOKEN`. Aucun PAT large ; le board est synchronisé par le broker OIDC.
- Rotation : `AUTH_SECRET` et le token de release sont renouvelés à chaque départ d'un
  détenteur ou soupçon de fuite ; la rotation invalide les sessions en cours (attendu).

### Inventaire

| Nom | Où | Nature | Remarque |
|---|---|---|---|
| `AUTH_SECRET` | Worker secret | secret | signature des sessions Better Auth |
| `HYPERDRIVE` | binding Hyperdrive | secret (URI Neon côté Cloudflare) | id provisionné par AppFactory |
| `PASSKEY_RP_ID` | Worker secret / var | sensible | hôte de l'application |
| `AUTH_BASE_URL`, `AUTH_TRUSTED_ORIGINS`, `PASSKEY_RP_NAME`, `INTEGRATION_*_MODE`, `SERVICE_NAME` | `wrangler.jsonc` | config | par environnement |
| `VITE_API_URL` | build web | config | vide = même origine |
| `VISUALS` | binding R2 (`wrangler.jsonc`) | config | bucket privé des logos et visuels ; requis quand `INTEGRATION_MEDIA_MODE=live` |
| `APPFACTORY_RELEASE_TOKEN` | GitHub secret | secret | Release Please uniquement |
| Clés des intégrations (CMS, publication, métriques, e-mail, LLM) | Worker secrets | secret | absentes tant que `INTEGRATION_*_MODE=mock` |

Vérification avant chaque release : la recherche de `AUTH_SECRET=` ou `postgresql://` dans
le dépôt (hors `*.example` et `docs/`) doit rester vide.

## 3. Qualité et sécurité (CI)

La CI est *change-scoped* (`.github/appfactory-impact.json`) : seuls les gates des surfaces
touchées s'exécutent ; un changement sans impact est un no-op.

| Gate | Couvre | Preuve |
|---|---|---|
| `web` | typecheck, build, Playwright desktop + Pixel 7 : parcours, clavier, transitions de validation (approuver, rejeter, renvoyer avec motif), axe WCAG 2.1 A/AA sur connexion, tableau de bord et page tâche | job `web` |
| `visual-qa` | pages publiques servies par le build : captures desktop/mobile, CTA accessible au clavier, overflow, images externes, motion réduite, axe, budgets Lighthouse (LCP ≤ 2,5 s, CLS ≤ 0,1, TBT ≤ 200 ms) | `reusable-visual-qa.yml`, artefact `appfactory-visual-qa` |
| `api` | typecheck, tests vitest (machine d'états, approbations liées au hash, Idempotency-Key, RBAC, audit), contrat OpenAPI à jour, bundle Worker en *dry run* | job `api` |
| `contracts` | client généré conforme à `openapi.json` | job `contracts` |
| `mobile-android` / `mobile-ios` | tests communs, capture Roborazzi (artefact), APK debug ; framework iOS lié | jobs mobile |
| `release-config` | cohérence Release Please (config ⊆ manifest) | job `release-config` |

Sécurité applicative en place : sessions httpOnly Better Auth (lien magique, passkey), RBAC par
produit, audit *append-only*, approbation liée au hash du contenu, idempotence des mutations.
Supply chain : actions et workflows réutilisables épinglés par SHA, `npm install
--ignore-scripts` en CI, dépendances revues à chaque PR.

## 4. Versioning et release

- **Release Please** en mode manifest, un composant par application : `web`, `api`, `contracts`,
  `mobile` (`.release-please-manifest.json`). Tags `web-v1.2.3`, `api-v1.2.3`, etc.
- Les versions sont propagées par `extra-files` : `package.json`, `src/version.ts` (API),
  `androidApp/build.gradle.kts` (`versionName`, ligne annotée `x-release-please-version`).
  `versionCode` Android reste manuel : +1 à chaque build publié sur un store, dans la PR de
  release.
- SemVer : *patch* correctif, *minor* fonctionnalité compatible, *major* rupture de contrat
  (`openapi.json`, format de config, événements). Une rupture est documentée dans la PR et,
  si elle touche un contrat consommé, dans un ADR.
- Flux : commits conventionnels → PR de release ouverte par Release Please → **revue humaine**
  → merge → tag + GitHub Release. Le déploiement n'est jamais un effet de bord du tag : il part
  de la release approuvée, vers `staging`, puis `production` après approbation de
  l'environnement.

## 5. Procédures

**Déployer (quand les environnements existeront)** : (1) release approuvée ; (2) job
`deploy-staging` sur le tag ; (3) smoke test : `GET /health`, connexion par lien magique,
approbation d'une tâche de test ; (4) approbation de l'environnement `production` par un
relecteur ; (5) même artefact vers `production` ; (6) entrée dans `PASSATION.md`.

**Revenir en arrière** : redéployer le tag précédent (Workers et Pages conservent les
versions) ; les migrations Drizzle sont additives (pas de suppression de colonne dans la même
release que le code qui cesse de l'utiliser).

**Incident ou near miss** : entrée dans `docs/engineering/lessons-learned.md` (contexte, cause
racine, résolution, prévention vérifiable) avant de clore l'incident.

## 6. Prérequis propriétaire (bloquants pour staging/production)

1. Neon + Hyperdrive via AppFactory U1 (`appfactory#185`).
2. Compte Cloudflare (Workers + Pages) et environnements GitHub `staging` / `production` avec
   *required reviewers*.
3. `APPFACTORY_RELEASE_TOKEN` posé ; Project doublon (#15) nettoyé.
4. Domaine (`PASSKEY_RP_ID`, `AUTH_BASE_URL`, App Links Android, Associated Domains iOS).
