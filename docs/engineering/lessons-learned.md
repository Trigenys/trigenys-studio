# Engineering Lessons Learned — Trigenys Studio

Mémoire des erreurs et near misses significatifs du projet, selon le standard RAIDER (failure memory). Les leçons transversales sont promues dans `EagleFox31/project-registry` → `docs/engineering/lessons-learned.md`.

## Entrées

### LESSON-STUDIO-2026-001 — Un bootstrap concurrent du board crée des Projects doublons

**Contexte** — Ouverture simultanée des 12 issues de démarrage alors que le workflow Project Automation était épinglé sur une version dont le bootstrap n'était pas sérialisé.

**Failure / near miss** — Deux Projects d'organisation « Trigenys Studio Development » (#24 et #25) ont été créés ; les issues ont été réparties entre les deux.

**Cause racine** — Le bootstrap (création du Project si absent) n'était pas idempotent sous concurrence : deux exécutions ont inspecté l'état « aucun Project » en parallèle, puis chacune a créé le sien.

**Résolution** — Le workflow a été repinné sur une version à bootstrap sérialisé (PR #14). Réconciliation : #24 retenu comme canonique (plus petit numéro, 13 items), l'item #13 présent uniquement dans #25 est resynchronisé vers #24, puis #25 est fermé (pas supprimé : réversible).

**Prévention** — Issue #15 : vérifier qu'un seul Project est lié au dépôt après tout changement de pin du workflow. Le pin est désormais le SHA stable `0523510a8e42290df3bae5749d034b1637569af5`.

**Leçon généralisée** — « Inspecter → créer si absent » n'est idempotent que sous verrou ou avec une contrainte d'unicité côté plateforme. Toute automatisation déclenchée par événement doit supposer la concurrence. Candidate à promotion dans le registre.
