# ADR 0015 — Release du Worker de production via AppFactory

Statut : accepté · Date : 2026-11-19 · Dépend de : Trigenys/appfactory#193

## Contexte

La base de production (`trigenys_studio`) est provisionnée et migrée par le job `database` du
workflow `appfactory-infrastructure.yml` (ADR 0002, PR #45). Le Worker `trigenys-studio-api` doit
maintenant être publié pour que la prestataire reçoive ses tâches (MCP, e-mail, WhatsApp). Aucun
jeton Cloudflare ne doit vivre dans ce dépôt, et l'id Hyperdrive ne doit pas être committé.

## Décision

- **Même chemin qu'Editorial OS / Commerce Factory** : le job `worker` (après `database`) appelle
  en OIDC `POST /infrastructure/worker` (amorçage, seulement si `.appfactory/worker-infrastructure.json`
  est absent), puis `POST /infrastructure/hyperdrive` (profil `trigenys-studio-production`), puis
  de nouveau `/infrastructure/worker` qui relance un build Workers Builds et exige l'état `ready`.
- **Requête déclarative** `.appfactory/worker.json` : runtime `typescript-wrangler`, racine
  `/services/api` (recette workspace npm d'AppFactory : `npm run check`, puis
  `npm exec --no -- wrangler deploy --config wrangler.production.jsonc --keep-vars`).
- **Hyperdrive** : `wrangler.production.jsonc` déclare `HYPERDRIVE` avec l'id factice
  `appfactory-managed-hyperdrive` (exactement une fois). AppFactory le remplace dans une copie
  temporaire au déploiement ; le fichier committé ne change jamais.
- **Secret de session** : `TRIGENYS_STUDIO_AUTH_SECRET` est généré une fois par AppFactory
  (jeton 64 caractères, conservé aux reruns). `authConfigFromEnv` le lit si `AUTH_SECRET` est
  absent ; `AUTH_SECRET` reste prioritaire.
- **Périmètre de cette release** : intégrations en mode `mock` (e-mail, WhatsApp, CMS…), pas de
  binding R2 (médias en mock jusqu'à la recette média privée). Les secrets réels et
  `INTEGRATION_*_MODE=live` viennent dans une PR suivante.

## Conséquences

- Le premier build déclenché par l'amorçage échoue au déploiement (id Hyperdrive pas encore
  connu) : bruit attendu, le build de release le remplace.
- Le gate de build est `typecheck` + `openapi:check` ; la suite de tests reste dans la CI
  (exécution en parallèle instable sous PGlite).
- Rerun du workflow : marqueurs présents, secrets préservés, Hyperdrive réutilisé → convergence
  sans nouvelle ressource.
- Retour arrière : redéployer la version précédente depuis Cloudflare (versions conservées) ;
  la base n'est pas touchée par ce job.
