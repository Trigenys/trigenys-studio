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

### LESSON-STUDIO-2026-006 — Un réconciliateur qui horodate chaque passage n'est pas idempotent

**Contexte** — Réconciliation des alertes (ADR 0011) : la première version mettait dans le détail d'une alerte la durée écoulée (« en attente depuis 26 h ») et dans ses `facts` l'instant du calcul.

**Failure / near miss** — Le test « un second passage sur des données inchangées n'écrit rien » échouait : chaque passage du cron aurait réécrit toutes les alertes, incrémenté leur version et laissé un audit.

**Cause racine** — Une valeur dérivée de « maintenant » dans l'état désiré rend toute comparaison avec l'état courant fausse par construction.

**Résolution** — Les règles ne produisent que des dates fixes (échéance, entrée en attente, dernière activité) ; la durée est calculée à l'affichage. Comparaison des `facts` sous forme canonique (jsonb réordonne les clés).

**Prévention** — Test de convergence obligatoire pour tout réconciliateur : second passage = rapport nul et aucune ligne modifiée. Convention notée en tête de `alerts/rules.ts`.

**Leçon généralisée** — L'état désiré d'un réconciliateur ne doit dépendre que des faits, jamais de l'heure du calcul ; sinon le diff ne converge jamais.

### LESSON-STUDIO-2026-007 — Drizzle retire le qualificatif de table dans une sous-requête corrélée

**Contexte** — Chargement des faits d'une tâche en un seul `select` sur `task`, avec des sous-requêtes corrélées écrites dans un fragment `sql` qui référençait la colonne drizzle `task.id`.

**Failure / near miss** — Les alertes « approbation requise » et « sans activité » ne s'ouvraient jamais, sans erreur : dans un select mono-table drizzle émet `"task_id" = "id"` sans qualificatif, et la sous-requête se comparait à elle-même.

**Cause racine** — Référencer une colonne drizzle dans un fragment `sql` d'une sélection sur une seule table produit un nom nu, résolu dans la portée la plus proche (la sous-requête).

**Résolution** — Noms qualifiés écrits en clair (`"task"."id"`, alias `tt`, `cv`, `cm`) dans les fragments corrélés ; commentaire en place dans `reconcile.ts`.

**Prévention** — Tests qui couvrent chaque règle avec des données qui la déclenchent réellement (ici une transition datée et des commentaires), pas seulement le cas « rien à signaler ».

**Leçon généralisée** — Un fragment SQL corrélé doit qualifier ses colonnes explicitement ; un résultat vide sans erreur est un signal de comparaison dégénérée.

### LESSON-STUDIO-2026-008 — Une horloge de test figée derrière l'horloge réelle est une bombe à retardement

**Contexte** — `test/alerts.test.ts` figeait `now` à `2026-11-06T12:00:00Z` et le passait au réconciliateur et à l'outbox de notifications, tandis que les routes HTTP du même test réconcilient avec `new Date()` et mettent en file des e-mails dus « maintenant » (`next_retry_at`).

**Failure / near miss** — CI verte le matin du 6 novembre, rouge l'après-midi sur une PR de documentation : la dispatch créée par la route portait un `next_retry_at` réel postérieur à l'horloge figée, l'outbox ne la réclamait plus, le compte `skipped` attendu (1) devenait 0.

**Cause racine** — Deux horloges dans un même scénario : l'une injectée et figée, l'autre réelle et non injectable (routes). Le test ne tenait qu'à la condition implicite « horloge réelle ≤ horloge figée », vraie seulement avant l'instant choisi.

**Résolution** — Ancre du test sur l'horloge réelle au chargement du module (`const now = new Date()`), outbox appelée avec `() => new Date()` ; les fixtures restent relatives (`hoursAgo`, `hoursAhead`). Classification : défaut de test, pas de produit.

**Prévention** — Dans un scénario qui mêle code à horloge injectée et routes à horloge réelle, ne jamais figer une date absolue : ancrer sur `new Date()` au chargement, ou injecter la même horloge partout. Revue : chercher `new Date("20` dans les tests et vérifier que le fichier n'appelle aucune route (`buffer-publisher`, `publishing`, `reporting` figent une date mais n'exercent que du code à horloge injectée).

**Leçon généralisée** — Un test qui dépend de « maintenant » sans le contrôler partout passe par accident ; une date absolue dans un test doit être soit strictement sans contact avec l'horloge réelle, soit relative à elle.

### LESSON-STUDIO-2026-009 — Un serveur e2e réutilisé peut donner un vert local sur une version périmée

**Contexte** — Refonte visuelle (PR #40). La suite Playwright locale affichait 98 tests verts juste avant l'ouverture de la PR ; le job CI `web` échouait sur 18 tests d'accessibilité (contraste des pastilles `warn`/`success` en thème clair, `label-content-name-mismatch` sur le lien Alertes porteur d'un `aria-label` différent du texte visible).

**Failure / near miss** — PR ouverte avec une preuve locale fausse. Relancée en local après coup, la même suite échouait (18 échecs) puis, une fois corrigée, comptait 116 tests, pas 98 : la première exécution avait tourné contre un serveur Vite déjà lancé sur le port 5190 (`reuseExistingServer` hors CI), sur un état de code différent, et le décompte montre qu'elle n'a pas exécuté tout le périmètre.

**Cause racine** — `reuseExistingServer: !process.env.CI` fait confiance à n'importe quel processus déjà présent sur le port e2e ; rien ne vérifie qu'il sert le code courant. Les messages axe n'indiquaient pas les couleurs mesurées, ce qui rendait le diagnostic plus lent.

**Résolution** — Tokens `--warn` et `--success` du thème clair assombris (ratio ≥ 5,4:1 sur fond teinté), `aria-label` remplacé par un suffixe `visually-hidden` (nom accessible qui contient le texte visible), helper `violations()` enrichi du couple fg/bg et du ratio mesuré.

**Prévention** — Avant une preuve e2e destinée à une PR : vérifier qu'aucun serveur n'occupe le port e2e (`netstat -ano | grep 5190`) ou lancer avec `CI=1` pour forcer un serveur neuf ; comparer le nombre total de tests exécutés au nombre attendu (116 aujourd'hui) et traiter un écart comme un échec. Revue : un `aria-label` sur un élément porteur de texte visible doit commencer par ce texte.

**Leçon généralisée** — Un vert obtenu contre un serveur dont on ne contrôle pas la version n'est pas une preuve ; la preuve inclut le périmètre exécuté (nombre de tests) et l'état servi.
