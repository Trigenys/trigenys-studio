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


### LESSON-STUDIO-2026-003 — Chaîne Android (Gradle 9.6, AGP 9.4, compileSdk 37.x) : dépréciations traitées en erreurs et plateformes mineures

**Contexte** — Premier build du client Compose Multiplatform (`apps/mobile`) avec Gradle 9.6 sans wrapper, AGP 9.4 et les dépendances AndroidX 1.12.x, hors poste de développement (image Docker, CI GitHub).

**Failure / near miss** — Trois arrêts successifs du build : (1) les AndroidX récents exigent `compileSdk ≥ 37`, or seules les plateformes mineures `android-37.0/37.1/37.2` sont publiées, absentes de l'image SDK ; (2) Gradle 9.6 convertit les dépréciations du DSL Kotlin en erreurs (`androidLibrary {}`, `compileSdkMinor`, accesseurs `compose.*`) ; (3) des API dépréciées dans le code et les tests (`TabRow`, `Month.number`, `headersOf(vararg)`, `createComposeRule` v1) cassaient la compilation avec `allWarningsAsErrors`.

**Cause racine** — Versions choisies « les plus récentes » sans vérifier les contraintes croisées (AndroidX ↔ compileSdk ↔ image SDK ↔ DSL AGP) ; aucune exécution hors poste avant d'écrire tout le module.

**Résolution** — `compileSdk { version = release(37) { minorApiLevel = 2 } }` partagé par le catalogue (`android-compileSdk`, `android-compileSdkMinor`) ; bloc `android {}` du plugin KMP ; artefacts Compose explicites ; image Docker dérivée `studio-android-sdk:37.2` (`platforms;android-37.2`) ; API remplacées par leurs successeurs.

**Prévention** — Le gate CI `mobile-android` installe explicitement `platforms;android-37.2` ; les versions sont centralisées dans `gradle/libs.versions.toml` ; toute montée de version AndroidX/AGP passe d'abord par la commande Docker du README mobile avant d'être poussée.

**Leçon généralisée** — Sur une chaîne de build à plusieurs couches (SDK, plugin, bibliothèques, outil de build), figer les versions ensemble et compiler dans l'environnement cible dès le premier fichier, pas une fois le module écrit.

### LESSON-STUDIO-2026-004 — Roborazzi n'écrit aucune capture sans mode `record`

**Contexte** — Test de capture `DayScreenScreenshotTest` (Robolectric + Roborazzi) exécuté en CI avec publication des PNG en artefact.

**Failure / near miss** — Le test passait vert mais le dossier `androidApp/src/test/screenshots/` restait vide : sans `-Proborazzi.test.record=true`, Roborazzi compare à une référence et ne crée rien quand elle manque.

**Cause racine** — Mode par défaut implicite (`compare`) supposé équivalent à « capturer ».

**Résolution** — Commande CI et README en mode `record` ; la capture de référence est versionnée.

**Prévention** — L'artefact CI `appfactory-visual-qa`/`mobile-screenshots` est inspecté lors de la revue de PR ; un test vert sans fichier produit est un signal d'alerte.

**Leçon généralisée** — Un outil qui « réussit » sans produire de sortie doit être vérifié sur sa sortie, pas sur son code de retour.

### LESSON-STUDIO-2026-004 — Des chiffres de mock plausibles passent pour des mesures

**Contexte** — Reporting (#10) : le fournisseur de métriques `mock` renvoyait des impressions et clics vraisemblables, pratiques pour remplir l'écran en développement.

**Failure / near miss** — Sans garde-fou, ces nombres auraient été persistés et affichés dans le rapport mensuel comme des mesures d'audience, indiscernables de vraies données pour le client.

**Cause racine** — Le port de métriques ne distinguait pas « source vérifiée » et « simulation » ; le rapport n'exigeait aucune provenance sur un chiffre.

**Résolution** — Drapeau `verified` sur le port ; seul un fournisseur vérifié peut écrire un relevé ; chaque relevé porte `provider`, `measuredAt`, `fetchedAt` ; sans source vérifiée la section dit « non connecté » et ne porte aucun chiffre (ADR 0010).

**Prévention** — Tests `reporting.test.ts` : en mode mock le rapport ne contient aucune mesure et le rafraîchissement répond 409 ; en mode vérifié chaque ligne a sa provenance. Le test e2e vérifie l'absence du mot « Impressions » hors connexion.

**Leçon généralisée** — Toute donnée destinée à un client qui ne naît pas dans le système doit porter sa provenance, et une simulation doit être impossible à persister, pas seulement désactivée par config.

### LESSON-STUDIO-2026-005 — Requête sur la connexion externe à l'intérieur d'une transaction PGlite : blocage silencieux

**Contexte** — Route `POST /reports/metrics/refresh` : l'audit ouvre une transaction (`audited(db, …, tx => …)`) et le rafraîchissement, écrit pour prendre `db`, interrogeait la connexion extérieure depuis l'intérieur.

**Failure / near miss** — Sous PGlite (harnais de tests, une seule connexion) le test restait suspendu jusqu'au timeout du hook, sans erreur ; sous Neon le même code aurait seulement perdu l'atomicité.

**Cause racine** — Deux voies d'accès à la base dans un même flux : la fonction métier ignorait la transaction en cours.

**Résolution** — Les fonctions appelées sous `audited` acceptent `Db | Tx` et reçoivent `tx` ; aucun accès à `db` dans un callback transactionnel.

**Prévention** — Convention consignée ici et dans `refresh.ts` ; un test qui dépasse son timeout sans sortie est désormais un signal à chercher d'abord ici.

**Leçon généralisée** — Un callback transactionnel ne doit recevoir que la transaction ; un timeout muet dans un harnais mono-connexion est un verrou, pas une lenteur.

