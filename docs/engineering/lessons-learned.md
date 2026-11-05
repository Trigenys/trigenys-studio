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

### LESSON-STUDIO-2026-002 — Syntaxe TypeScript non strippable dans le code partagé avec les scripts Node

**Contexte** — Les scripts `services/api/scripts/*.ts` (export OpenAPI) importent le code applicatif et tournent avec le type stripping natif de Node 24, alors que vitest et wrangler passent par esbuild.

**Failure / near miss** — Une classe avec des *parameter properties* (`constructor(readonly status: number)`) a cassé `openapi:export` (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`) alors que typecheck, tests et build étaient verts.

**Cause racine** — Trois chaînes d'exécution différentes pour le même code ; seule la CI (`openapi:check`) aurait révélé l'écart après coup.

**Résolution** — Champs déclarés puis affectés dans le constructeur ; aucune syntaxe à transformation (parameter properties, enums, namespaces) dans `src/`.

**Prévention** — `tsconfig` de l'API avec `erasableSyntaxOnly: true` (TypeScript ≥ 5.8), vérifié par `npm run typecheck` ; la CI continue d'exécuter `openapi:check`.

**Leçon généralisée** — Quand un même source est exécuté par plusieurs runtimes, aligner le sous-ensemble de syntaxe sur le plus strict et le faire vérifier par le compilateur, pas par l'exécution.

