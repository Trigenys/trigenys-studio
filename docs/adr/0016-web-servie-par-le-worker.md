# ADR 0016 — Web app servie par le Worker de production, notifications en direct

Statut : accepté · Date : 2026-11-19 · Dépend de : ADR 0013, 0014, 0015, Trigenys/trigenys-notify#74

## Contexte

Les e-mails et messages WhatsApp d'assignation portent un lien vers la tâche
(`${WEB_APP_URL}${path}`) ; sans `WEB_APP_URL`, rien ne part (audité `skipped`). La web app
n'était déployée nulle part, et Notify n'accepte que des liens https vers une origine autorisée
(`allowedLinkOrigins`). Le Worker est publié par AppFactory avec une recette figée : build
`npm run check` dans `services/api`, puis `wrangler deploy --config wrangler.production.jsonc`.

## Décision

- **Même origine** : le Worker `trigenys-studio-api` sert aussi le build de `apps/web`
  (Workers static assets, binding `ASSETS`). Pas de second projet Pages, pas de CORS, cookies de
  session first-party ; `VITE_API_URL` reste vide.
- **Aiguillage par nature de requête, pas par chemin** : web et API partagent des chemins
  (`/tasks/:id` est une page et une ressource). Les fichiers hachés (`/assets/*`, `favicon.svg`)
  sont servis directement ; tout le reste passe par le Worker, qui envoie les chargements de page
  (`Sec-Fetch-Mode: navigate`, ou `Accept: text/html` sans Fetch Metadata) vers `ASSETS`
  (repli `index.html`) et le reste vers l'API (`src/web/spa.ts`). `/api/*`, `/mcp`, `/health*`
  et `/openapi.json` ne vont jamais à l'app (rappels Better Auth, MCP, sondes).
  Le repli SPA natif de Cloudflare seul a été écarté : en preuve locale il renvoyait
  `index.html` à un `fetch('/tasks/…')`.
- **Build dans la recette** : `npm run check` installe puis construit aussi la web app (`build:web` ;
  la recette n'installe que le workspace `services/api`), seule
  étape exécutée par la recette AppFactory ; `wrangler deploy` embarque `apps/web/dist`.
- **Notifications en direct** : `INTEGRATION_EMAIL_MODE=live`, `INTEGRATION_WHATSAPP_MODE=live`,
  `WHATSAPP_NOTIFY_EVENTS=task_assigned`, base Notify
  `https://trigenys-notify-staging-api.lawrynnjennifer.workers.dev`, `WEB_APP_URL` et
  `AUTH_TRUSTED_ORIGINS` = origine du Worker. Clés produit posées en *Worker secrets* des deux
  côtés (`NOTIFY_EMAIL_INGEST_KEY`, `NOTIFY_WHATSAPP_INGEST_KEY`).

## Conséquences

- Un changement de `apps/web` n'atteint la production qu'au prochain lancement du workflow
  `appfactory-infrastructure.yml` (déclenchement manuel, ses filtres `paths` ne couvrent pas
  `apps/web`).
- `npm run check` de l'API dure plus longtemps (build Vite) ; la CI n'appelle pas ce script.
- En local et dans les tests, `ASSETS` est absent : l'enveloppe est un no-op.
- Passage à un domaine propre : changer `AUTH_BASE_URL`, `WEB_APP_URL`,
  `AUTH_TRUSTED_ORIGINS` ici et `allowedLinkOrigins` côté Notify, dans la même fenêtre.
