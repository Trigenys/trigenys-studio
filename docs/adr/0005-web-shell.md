# ADR 0005 — Shell web : routage, données, session et tests

- Statut : accepté — 2026-11-05
- Issue : #4

## Contexte

Le cockpit web (ADR 0001) doit offrir « Ma journée » : filtre par produit, vues Aujourd'hui / À valider / Programmées / En retard, recherche, états vide / chargement / erreur, navigation clavier et mobile. Le socle est React 19 + Vite ; l'API expose un contrat OpenAPI et un client typé (`@trigenys/studio-contracts`), l'identité est servie par Better Auth (ADR 0002, #22).

## Options

1. **Routage** : état local (`useState`) ou `react-router` (mode déclaratif). Retenu `react-router` : l'URL porte la vue, le produit et la recherche, donc partageable, rechargeable et accessible (liens réels, `aria-current`).
2. **Données** : `fetch` + `useEffect` ou `@tanstack/react-query`. Retenu React Query : cache par clé, états `pending` / `error` / `success` uniformes, invalidation après mutation, `retry` contrôlé (jamais sur 401).
3. **Session** : `useSession` de Better Auth ou `GET /me`. Retenu `/me` comme unique source de vérité (identité + grants) ; le client Better Auth ne sert qu'à se connecter (magic link, passkey) et se déconnecter.
4. **Vues** : un appel par vue avec les filtres serveur, ou une liste par produit dérivée côté client. Retenu la dérivation client (`views.ts`, fonctions pures) : un seul appel, compteurs cohérents entre vues, changement de vue instantané ; les filtres serveur restent disponibles pour le mobile.
5. **Tests** : tests unitaires de composants (Testing Library) ou Playwright contre l'API mockée au niveau réseau. Retenu Playwright : il couvre en un outil le rendu réel, le clavier, le mobile (profil Pixel 7) et les états d'erreur, sans base ni Worker en CI.
6. **UI** : bibliothèque de composants ou CSS maison. Retenu CSS maison dans le thème du socle : surface réduite, pas de dépendance pour une dizaine de composants.

## Décision

Options retenues ci-dessus. En développement, Vite proxie les préfixes de l'API vers le Worker (`localhost:8787`) pour que le cookie de session reste same-origin ; en production `VITE_API_URL` désigne le Worker, ou reste vide si web et API sont servis derrière le même hôte.

## Conséquences

- Dépendances ajoutées : `react-router`, `@tanstack/react-query`, `better-auth` + `@better-auth/passkey` (client), `@playwright/test` (dev).
- La règle métier reste côté serveur : la page tâche n'affiche que `allowedTransitions` et laisse le serveur refuser (403/409 affichés tels quels).
- Le gate CI `web` installe Chromium et exécute les tests Playwright ; coût ~1 min.
- Le déploiement cross-origin (cookie `SameSite=None`, domaine) est traité avec l'incrément de déploiement, une fois le compte Cloudflare disponible.
