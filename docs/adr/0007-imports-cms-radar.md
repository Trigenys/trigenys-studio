# ADR 0007 — Entrées depuis le CMS Insight et le radar Editorial OS

Statut : accepté · Date : 2026-11-05 · Issue : #7

## Contexte

Le travail existe déjà ailleurs : les articles vivent dans le CMS Trigenys Insight (Payload),
les sujets proposés sortent du radar d'Editorial OS. Le Studio doit les recevoir sans dupliquer
ni republier, sans dépasser les droits du CMS, et en conservant provenance et dates.
Aucun des deux systèmes n'offre de webhook ; les deux exposent une API de lecture authentifiée
par jeton de service (`POST /api/editorial-os` opération `list-posts` ; `GET /api/operator/runs`).

## Décision

- **Pull, pas push.** Une synchronisation déclenchée par un opérateur (`POST /imports/sync`)
  interroge les adaptateurs `Cms.listArticles` et `Radar.listProposals` et enregistre chaque
  élément dans `import_item`, clé unique `(origin, external_ref)`.
- **Idempotence.** La synchronisation fait un upsert de la description (titre, résumé, URL,
  sources, dates) et ne touche jamais `status`, `task_id` ni la décision : rejouer une
  synchronisation ne crée ni doublon ni réinitialisation.
- **Prévisualisation puis action humaine.** Un élément reste `new` jusqu'à ce qu'un opérateur
  en fasse une tâche (`POST /imports/{id}/task`, état initial du pipeline, sources
  `task_source` d'origine `cms` ou `radar` portant date et références) ou l'ignore.
- **CMS en lecture seule.** Le jeton Insight a des droits d'écriture ; le Studio ne s'en sert
  que pour lister. Aucune route n'écrit vers le CMS ni vers Editorial OS.
- **Secrets hors dépôt.** URLs de base en variables, jetons en secrets Worker ; mode `mock`
  par défaut, `live` exige les deux.

## Conséquences

- Le CMS reste la source de vérité des articles ; le Studio n'en garde qu'un résumé daté.
- Un sujet du radar lié à une tâche ne sera jamais relié deux fois (409), même après resync.
- Les évolutions des API amont sont confinées aux adaptateurs, testés avec un `fetch` injecté.
- Non couvert : locale EN du CMS (un seul `locale` par adaptateur, `fr` par défaut) et
  synchronisation planifiée (cron) — à décider quand le volume le justifiera.
