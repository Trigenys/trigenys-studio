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

### LESSON-STUDIO-2026-010 — Une preuve de build dans un checkout installé ne prouve pas le build de la recette

**Contexte** — PR #48 : `npm run check` de `services/api` construit aussi `apps/web` (`build:web`) pour que la recette AppFactory embarque la web app dans le Worker.

**Failure / near miss** — Après fusion, le Workers Build `trigenys-studio-api` échoue (`CLOUDFLARE_WORKERS_BUILD_FAILED`, runs 44534058093 et 44534087291) ; la production reste sur la version précédente. La preuve locale (`npm run check`, `wrangler deploy --dry-run`) était verte.

**Cause racine** — La recette lance `npm install` depuis `/services/api` : npm n'installe alors que ce workspace. Les dépendances de `apps/web` (`vite`, `@vitejs/plugin-react`, types React, lien `@trigenys/studio-contracts`) manquaient. Le checkout local avait tout le monorepo installé à la racine et masquait l'écart.

**Résolution** — `build:web` installe d'abord le workspace web (`npm install --workspace @trigenys/studio-web`, no-op s'il est déjà installé, lockfile inchangé) puis le construit. Reproduit puis validé dans un clone neuf à `bf8a179`.

**Prévention** — Toute modification de la recette de build (scripts appelés par `npm run check`) se prouve dans un clone neuf, en rejouant la commande exacte de la recette depuis son `rootDirectory` (`npm install --ignore-scripts --no-audit --no-fund && npm run check` dans `services/api`), pas dans le checkout de travail.

**Leçon généralisée** — Une preuve de build vaut pour l'environnement où elle tourne ; reproduire l'état initial de la cible (clone neuf, même répertoire, même commande) avant de conclure.

### LESSON-STUDIO-2026-011 — `fetch` rangé sur un objet lève « Illegal invocation » sur Workers

**Contexte** — Premier passage de l'e-mail en `live` en production (#48/#49) : demande de lien de connexion sur la web app.

**Failure / near miss** — « Envoi impossible » côté écran, HTTP 500 sur `/api/auth/sign-in/magic-link`. `wrangler tail` : `UpstreamError: trigenys-notify-mailer: unreachable (Illegal invocation: function called with incorrect this reference)`.

**Cause racine** — Les adaptateurs HTTP gardaient `options.fetch ?? fetch` dans `this.fetchImpl` et `NotifyMailer`/`NotifyWhatsApp` l'appelaient comme méthode : le `fetch` global reçoit alors l'adaptateur comme `this`, ce que le runtime Workers refuse. Node l'accepte, et tous les tests injectaient un `fetch` : le chemin par défaut n'était jamais exercé.

**Résolution** — `defaultFetch` partagé (`src/integrations/upstream.ts`) qui appelle toujours le `fetch` global non lié, utilisé par les six adaptateurs. Test `default-fetch.test.ts` avec un `fetch` global qui reproduit la règle Workers (rouge avant, vert après).

**Prévention** — Un adaptateur ne stocke jamais le `fetch` global brut : il utilise `defaultFetch`. Revue : `grep -rn "?? fetch\b" services/api/src` doit rester vide. Tout passage d'une intégration en `live` se teste en production sur un envoi réel avant d'annoncer la mise en service.

**Leçon généralisée** — Un chemin par défaut que les tests remplacent toujours par une doublure n'est pas testé ; reproduire dans au moins un test la contrainte du runtime cible.

### LESSON-STUDIO-2026-012 — Un Worker ne joint pas un autre Worker `workers.dev` du même compte par `fetch`

**Contexte** — Même mise en service de l'e-mail `live`, juste après le correctif LESSON-STUDIO-2026-011.

**Failure / near miss** — Toujours HTTP 500 sur `/api/auth/sign-in/magic-link` ; `wrangler tail` : `UpstreamError: trigenys-notify-mailer: HTTP 404`. La même requête depuis un poste répond bien (401 sans clé) : la route Notify existe.

**Cause racine** — Studio et Notify sont deux Workers `*.workers.dev` du même compte Cloudflare. Un `fetch` global de l'un vers l'autre est refusé par la plateforme (erreur 1042, vue comme un 404) sauf avec le drapeau `global_fetch_strictly_public` ou une service binding. Invisible hors du runtime de production : ni Node ni les tests ne passent par le réseau Cloudflare.

**Résolution** — `global_fetch_strictly_public` ajouté à `compatibility_flags` (production et local) ; l'URL Notify reste configurable, aucun changement d'adaptateur.

**Prévention** — `test/worker-config.test.ts` échoue si le drapeau disparaît d'une des configs. Toute intégration Worker → Worker du compte passe par ce drapeau ou par une service binding, décidé dans l'ADR qui l'introduit.

**Leçon généralisée** — Un appel entre deux services du même fournisseur n'est pas un appel « Internet » ordinaire : vérifier les règles de routage interne du fournisseur avant d'annoncer une intégration, et tester l'appel réel depuis le runtime cible.

### LESSON-STUDIO-2026-013 — Une URL de base prêtée sans `sslmode` ouvre une connexion en clair

**Contexte** — Premier admin de production par `npm run db:bootstrap-admin` dans le workflow d'infrastructure (PR #53), juste après les migrations du même job.

**Failure / near miss** — Les migrations passent, le bootstrap échoue aussitôt : « Admin bootstrap failed (database error) », sans autre indice.

**Cause racine** — Le bail AppFactory renvoie une URL sans `sslmode`. `drizzle.config.ts` passe par `migrationCredentials` (TLS `verify-full` imposé hors local) ; le nouveau script donnait l'URL brute à `postgres()`, qui tente alors une connexion sans TLS que Neon refuse. Le message d'erreur masqué entièrement (pour ne pas fuiter l'URL) cachait aussi la cause.

**Résolution** — Le script construit sa connexion avec `migrationCredentials(url)` ; en cas d'échec il affiche le code SQLSTATE, jamais le message ni l'URL.

**Prévention** — `test/bootstrap-admin.test.ts` échoue si un script de `scripts/` qui lit `DATABASE_URL` n'utilise pas `migrationCredentials`.

**Leçon généralisée** — Tout nouveau point d'entrée vers une ressource déjà durcie réutilise le helper de connexion existant, pas la valeur brute ; et une erreur expurgée garde un identifiant sûr (code) pour rester diagnosticable.

### LESSON-STUDIO-2026-014 — Un `Date` lié à une expression `sql` part en texte brut en production

**Contexte** — Première lecture du rapport éditorial (`get_editorial_report`) depuis un client MCP sur la production.

**Failure / near miss** — HTTP 500 à chaque appel. Les logs du Worker montrent « Failed query » sur la requête des publications (`first_published`). Les tests (PGlite) passent.

**Cause racine** — Le driver postgres-js de Drizzle désactive ses sérialiseurs de dates. Un `Date` n'est converti en ISO que par le mapper d'une colonne `timestamp`. Comparé à un alias (`min(created_at) as published_at`) ou à un `coalesce(sent_at, scheduled_at)`, il est envoyé en `String(date)`, que Postgres refuse. PGlite accepte ce format, donc les tests ne le voyaient pas.

**Résolution** — Les bornes de ces deux comparaisons sont envoyées en `toISOString()` avec un cast `::timestamptz`.

**Prévention** — Le harness de test (`test/support/harness.ts`) branche un logger Drizzle. Il fait échouer toute requête qui reçoit un paramètre `Date` brut, ce qui reproduit la contrainte de production dans toute la suite.

**Leçon généralisée** — Quand la base de test est plus tolérante que celle de production, encoder la règle de production comme garde-fou dans la doublure de test, plutôt que de compter sur la relecture.

### LESSON-STUDIO-2026-015 — Un stockage simulé partagé en test masque un stockage vide à chaque requête

**Contexte** — Import de logo puis génération d'un visuel avec la configuration de production.

**Failure / near miss** — L'import répond 201, mais la lecture suivante répond 404 et le rendu répond 409. Les métadonnées sont en base, les octets ont disparu.

**Cause racine** — Le mode média restait `mock` sans binding R2 en production. Le middleware appelle `createIntegrations` à chaque requête, qui crée un `MemoryMediaStore` vide. Le harness injecte au contraire un même stockage partagé : ses tests ne reproduisaient pas cette durée de vie.

**Résolution** — Activer l'adaptateur R2 existant avec un bucket privé provisionné par la recette AppFactory `private-media` avant release. En développement, utiliser le simulateur R2 local de Wrangler. Aucun cache global en mémoire ne remplace le stockage durable.

**Prévention** — `test/media-persistence.test.ts` lit le mode et le binding dans la configuration de production, conserve uniquement le bucket de test entre les appels et recrée l'application pour chaque requête. Il couvre import, lecture, rendu, relecture et refus sans session ; il échoue en 404 avec l'ancienne configuration.

**Leçon généralisée** — Pour une intégration avec état, vérifier sa durée de vie réelle et le choix de l'adaptateur de production. Une dépendance injectée plus durable que celle du runtime peut rendre la suite verte tout en masquant une perte de données.
