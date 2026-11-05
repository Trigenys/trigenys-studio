# ADR 0004 — Contributions amont à AppFactory et Project Automation

- Statut : accepté — 2026-11-05
- Issue : #2, #12

## Contexte

LESSON-2026-002 du registre : un correctif ou une capacité spécifique à un produit doit être promu dans le service partagé qui en est propriétaire, pas conservé dans le produit. Studio a besoin de capacités qu'AppFactory ne fournit pas encore.

## Décision

Chaque capacité manquante fait l'objet d'une issue puis d'une PR séparée dans le dépôt propriétaire. Studio peut servir de pilote (implémentation locale) à condition de remonter la capacité avant la release MVP (#12).

| # | Dépôt | Sujet | Bloquant pour Studio |
|---|---|---|---|
| U1 | appfactory | Ajouter `Trigenys/trigenys-studio` à `APPFACTORY_NEON_TARGETS` (configuration serveur) | Incrément 2 (premier déploiement API) |
| U2 | appfactory | Matérialisation de blueprint dans un sous-chemin (`targetPath`) pour les monorepos | Non |
| U3 | appfactory | Variante `typescript-api` en adaptateur Worker (Hono + Drizzle + Hyperdrive + wrangler) | Non — Studio pilote |
| U4 | appfactory | Blueprint mobile `platform: kmp` (Compose Multiplatform Android + iOS, Roborazzi, CI macOS gardée) | Incrément 6 — Studio pilote sinon |
| U5 | project-automation | `reusable-mobile-release-android.yml` (AAB signé, piste interne Play, secrets en environnement protégé) | Première distribution Android |
| U6 | project-automation | `reusable-mobile-release-ios.yml` (macOS, clé API App Store Connect, signature, TestFlight) | Première distribution iOS |
| U7 | project-automation | Mode manifest monorepo dans `reusable-release.yml` | Déjà supporté (`config-file`, `manifest-file`) — aucune action |
| U8 | appfactory | Contrôle de dérive OpenAPI et génération de clients TS/Kotlin réutilisables | Non |

## Conséquences

- Les workflows de Studio épinglent le SHA revu `0523510a8e42290df3bae5749d034b1637569af5` (v1.4.0) déjà autorisé par le broker OIDC.
- Les issues amont sont ouvertes à l'incrément 1 pour U1 et U2, puis au fil des incréments pour les autres.
