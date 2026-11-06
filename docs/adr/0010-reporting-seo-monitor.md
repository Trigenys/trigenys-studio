# ADR 0010 — Reporting éditorial, objectifs de contrat et mesures vérifiées (SEO Monitor)

Statut : accepté · Date : 2026-11-06 · Issue : #10

## Contexte

Le client d'un produit veut savoir chaque mois ce que le Studio a livré (tâches, articles,
publications par réseau) et où en est le contrat (objectifs). Il veut aussi des chiffres
d'audience (impressions, clics) — mais ces chiffres ne naissent pas dans le Studio : ils vivent
dans le SEO Monitor, le CMS ou les réseaux. Le risque principal est de présenter des nombres
plausibles mais fictifs (sortis d'un mock ou d'une estimation) comme des mesures.

## Décision

- **Deux régimes, jamais mélangés.** Le rapport (`GET /reports/editorial?month&productId`) sépare
  l'*opérationnel* — comptages SQL sur les données du Studio (tâches échues, terminées, en retard
  par produit et type ; articles publiés ; livraisons par produit et réseau), étiqueté « calculé
  depuis Studio » — et le *vérifié* — relevés horodatés d'un fournisseur marqué `verified`, avec
  provenance (`provider`, `measuredAt`, `fetchedAt`) sur chaque ligne.
- **Un mock n'est jamais une mesure.** Le port `MetricsProvider` porte un drapeau `verified`.
  L'adaptateur `mock` ne l'a pas : la section « Mesures vérifiées » dit alors « non connecté »
  avec la raison actionnable, et ne porte aucun chiffre. `POST /reports/metrics/refresh` répond
  409 `metrics-not-connected`. Aucun relevé mock n'est persisté.
- **Contrat HTTP JSON générique, pas d'API tierce devinée.** L'adaptateur `http-json-metrics`
  appelle `GET {METRICS_BASE_URL}/v1/metrics?kind=url|post&ref=` avec un bearer `METRICS_TOKEN`
  et attend `{ measuredAt, metrics: { nom: nombre } }` ou 404 (pas encore mesuré). Le SEO Monitor
  (ou un mince proxy) implémente ce contrat ; le Studio ne connaît pas son API interne.
- **Relevés dédupliqués et périodiques.** `metric_snapshot` est unique sur
  `(provider, target_kind, target_ref, measured_at)` : un rafraîchissement convergé n'écrit rien
  (`unchanged`). Les cibles sont les livraisons envoyées (permalien) et les articles publiés
  (URL) ; `METRICS_BATCH` cibles par passage, au plus toutes les `METRICS_REFRESH_MINUTES`, via
  le cron existant ou l'appel admin.
- **Objectifs de contrat comme données.** `contract_objective` (produit, mesure
  `tasks_completed | articles_published | deliveries_sent`, type ou réseau optionnels, cible
  mensuelle, version optimiste, `active`). Unicité partielle sur la portée active : un objectif
  n'est pas supprimé, il est désactivé. La progression est calculée côté serveur sur le mois UTC.
- **Lien SEO Monitor par produit.** `product.seo_monitor_url` (https uniquement, admin) : le
  rapport renvoie au tableau de bord externe plutôt que d'en recopier les chiffres.
- **Mois UTC.** `month=YYYY-MM` borne `[from, to)` en UTC ; l'affichage local est à la charge du
  client.

## Conséquences

- Migration additive `0008_reporting.sql` ; index sur `delivery.sent_at` et
  `task_transition(to_state, created_at)` pour les comptages.
- RBAC : `report.read` (admin, opérateur, relecteur), `objective.manage` et `metrics.refresh`
  (admin).
- Web : page `/reports` (mois, filtre produit, objectifs, SEO Monitor, rafraîchissement admin) ;
  le texte distingue toujours la provenance.
- Tant qu'aucun fournisseur `live` n'est configuré, la section vérifiée reste vide par
  construction : c'est voulu, pas un défaut.

## Alternatives écartées

- Chiffres d'audience estimés depuis le mock « pour montrer l'écran » : refusé, c'est la source
  même du risque (voir `docs/engineering/lessons-learned.md`, LESSON-STUDIO-2026-004).
- Adaptateurs natifs LinkedIn / Google Search Console : contrats instables et clés à gérer ; un
  seul contrat JSON côté SEO Monitor couvre le besoin et reste remplaçable.
