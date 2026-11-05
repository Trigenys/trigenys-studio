# ADR 0002 — Backend : Worker Cloudflare `trigenys-studio-api`, Hono, Drizzle, Neon via Hyperdrive

- Statut : accepté — 2026-11-05
- Issue : #2, #3

## Contexte

Le commanditaire impose Neon (Postgres). AppFactory sait déjà provisionner une base et un rôle Neon et pousser l'URI de connexion comme secret d'un Worker Cloudflare nommé `<repo>-api`, fournir un profil Hyperdrive et délivrer un bail OIDC aux jobs GitHub Actions (migrations) sans qu'aucun mot de passe ne transite par le dépôt. Ce chemin est déjà utilisé par Product Identity, SEO Monitor et Editorial OS.

## Options

1. **Service Node `typescript-api` hébergé ailleurs** (VM, conteneur). Rejeté : on perd le provisionnement Neon automatisé, le bail OIDC et on ajoute un hébergement à exploiter.
2. **Worker Cloudflare `trigenys-studio-api`** aligné sur la convention AppFactory. Retenu.

Sous-choix :
- Framework : **Hono** + `@hono/zod-openapi` (schémas zod → OpenAPI 3.1).
- ORM : **Drizzle** (driver postgres.js via Hyperdrive), migrations `drizzle-kit` exécutées en CI sous bail OIDC.
- Contrat : **OpenAPI 3.1** commité dans `packages/contracts/openapi.json`, contrôle de dérive en CI ; clients générés TS (`openapi-typescript` + `openapi-fetch`) et Kotlin (`openapi-generator`, bibliothèque multiplatform/Ktor). tRPC écarté : non consommable par Kotlin.
- Auth : **Better Auth** auto-hébergé (adaptateur Drizzle, tables dans Neon), passkeys + magic link, plugin bearer pour le mobile. Cloudflare Access écarté (inadapté aux apps natives) ; Clerk écarté (identité hors Neon, SaaS tiers).
- Asynchrone : table outbox + Cloudflare Queues pour les intégrations ; Cron Triggers pour la synchronisation des métriques ; R2 pour les visuels.

## Décision

Option 2 avec les sous-choix ci-dessus. RBAC déclaratif (`role_assignment(user, role, product?)`, politiques dans `policies.ts`, middleware `authorize(action, resource)`). Journal d'audit `audit_event` en ajout seul, écrit dans la même transaction que la mutation ; le rôle base de données de l'API n'a ni `UPDATE` ni `DELETE` sur cette table. Les transitions du pipeline sont décidées exclusivement côté serveur.

## Conséquences

- Dépendance assumée à Cloudflare, cohérente avec le reste de la plateforme Trigenys ; documentée ici comme dérogation au principe Agnostic.
- Contribution amont U1 (cible Neon dans `APPFACTORY_NEON_TARGETS`) bloquante avant le premier déploiement ; U3 (variante Worker du blueprint `typescript-api`) à remonter une fois Studio stabilisé.
- Risque : compatibilité Better Auth / postgres.js / Hyperdrive sur Workers (`nodejs_compat`). Spike de connexion bout en bout prévu à l'incrément 2 ; plan B : Auth.js ou implémentation maison sur les mêmes tables.
