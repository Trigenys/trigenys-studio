# Discovery — parcours, rôles et critères de succès

Issue de référence : #1. Phase : Discovery. Dernière mise à jour : 2026-11-05.

## 1. Mission du produit

Trigenys Studio est le cockpit interne qui centralise le travail quotidien de communication pour trois produits : **Trigenys Insight**, **Précis Translator** et **Atelier Maître**. Il orchestre un pipeline éditorial assisté par IA, mais **aucune publication ni connexion à un compte externe n'est déclenchée sans permission et validation humaine explicites**.

Studio est un orchestrateur d'interface : il ne réimplémente pas les moteurs existants (CMS Insight, radar Editorial OS, pipeline visuel, Buffer, SEO Monitor). Il les pilote derrière des contrats explicites, mockés tant que l'accès réel n'est pas branché.

## 2. Personas

| Persona | Rôle système | Objectif quotidien | Frustrations à supprimer |
|---|---|---|---|
| **Opératrice communication** (persona principal) | `operator` | Savoir en un écran ce qui est à faire aujourd'hui, produire et faire valider des contenus, programmer ce qui est approuvé | Fils de discussion IA éparpillés, contexte produit à ressaisir, incertitude sur « est-ce validé ? » |
| **Administratrice** | `admin` | Gérer rôles, produits, comptes sociaux, brand kits, auditer ce qui a été publié et par qui | Comptes connectés sans traçabilité, règles de validation implicites |
| **Relecteur** (phase ultérieure) | `reviewer` | Relire et approuver/rejeter un contenu avec un commentaire | Devoir ouvrir trois outils pour voir le brief, la source et le visuel |

## 3. Parcours de référence

### 3.1 Journée type de l'opératrice (web)

1. Ouvre **Ma journée** : vues *Aujourd'hui*, *À valider*, *Programmées*, *En retard*, filtrées par produit.
2. Prend une tâche *À qualifier* issue du radar Editorial OS ou d'une demande manuelle ; vérifie le dossier éditorial (thème, angle, sources).
3. Lance la **préparation IA** depuis la tâche : l'assistant reçoit le contexte (produit, brand kit, sources, canal) et propose une version de contenu, enregistrée comme `content_version` marquée `ai_assisted`.
4. Relit, corrige, passe en *Relecture* puis *Visuels* (génération multi-formats via le pipeline visuel, variantes stockées).
5. Passe en *À valider* : l'approbation lie le contenu et les visuels par empreinte (hash). Toute modification ultérieure invalide l'approbation.
6. Une fois *Approuvé*, programme la publication (Buffer) sur les comptes sociaux mappés au produit. L'état devient *Programmé*, puis *Publié* après confirmation du fournisseur.
7. Les métriques remontent (Buffer, SEO Monitor) : état *Mesuré*.

Critère : retrouver une tâche et son contexte en **au plus trois interactions courantes** (#4).

### 3.2 Validation en mobilité (Android / iOS)

Périmètre mobile volontairement restreint : *Ma journée*, *À valider*, approuver / rejeter avec commentaire, consultation d'une tâche, notifications push. La production de contenu reste sur le web.

### 3.3 Administration

Gérer produits, brand kits, comptes sociaux (mapping Buffer), rôles par produit, règles de validation et SLA ; consulter le journal d'audit.

## 4. Matrice RBAC (MVP)

Les rôles sont attribués globalement ou par produit (`role_assignment(user, role, product?)`). Toute autorisation est vérifiée côté serveur à chaque opération.

| Action | operator | reviewer | admin |
|---|---|---|---|
| Voir Ma journée, tâches, dossiers du produit | ✓ | ✓ | ✓ |
| Créer / éditer tâche, brief, contenu | ✓ | – | ✓ |
| Lancer préparation IA, génération visuelle | ✓ | – | ✓ |
| Passer en *À valider* | ✓ | – | ✓ |
| Approuver / rejeter | – (sauf si désigné) | ✓ | ✓ |
| Programmer / publier (état *Approuvé* uniquement) | ✓ | – | ✓ |
| Gérer comptes sociaux, brand kits, produits | – | – | ✓ |
| Gérer rôles, règles de validation, SLA | – | – | ✓ |
| Consulter le journal d'audit | lecture propre | lecture propre | ✓ |

Règle MVP : l'auto-approbation est interdite par défaut (l'approbateur ≠ auteur de la dernière version), sauf réglage admin explicite pour une organisation à une seule personne.

## 5. Règles de validation et SLA

- Un contenu n'est publiable que depuis l'état *Approuvé*, avec une approbation dont les empreintes (`content_hash`, `asset_set_hash`) correspondent à l'état courant.
- Une approbation est **tracée** : qui, quand, sur quelle version, avec quel commentaire. Elle est immuable (journal d'audit en ajout seul).
- SLA de relecture par défaut : 1 jour ouvré ; au-delà, la tâche apparaît dans *En retard* et une notification est émise. Paramétrable par produit.
- Les actions répétées (double clic, retry réseau) ne créent jamais de doublon : clé d'idempotence sur toute mutation.

## 6. Inventaire des outils existants et frontières

| Outil | Rôle pour Studio | Frontière |
|---|---|---|
| CMS Trigenys Insight | Source d'articles, cible de publication web | Studio importe/relie, ne réécrit pas le CMS |
| Radar Editorial OS | Source de sujets qualifiés | Studio consomme, ne recalcule pas le radar |
| Pipeline visuel existant | Génération de variantes multi-formats | Studio soumet un brief + brand kit, stocke les sorties |
| Buffer | Programmation / publication sociale | Studio planifie uniquement depuis *Approuvé* ; accès API à confirmer (risque identifié) |
| SEO Monitor | Métriques post-publication | Studio lit des snapshots |
| AppFactory / Project Automation | Provisionnement, Neon, CI, board | Studio consomme les workflows réutilisables |

Tous ces accès sont **mockés** jusqu'à ce que les identifiants réels soient fournis hors dépôt.

## 7. Définition de « prêt à publier »

Une tâche est prête à publier si et seulement si :

1. état = *Approuvé* ;
2. une approbation valide existe pour la version de contenu et le jeu de visuels courants ;
3. un compte social mappé et actif existe pour le produit et le canal ;
4. l'acteur qui programme possède le droit *programmer* sur ce produit ;
5. la date de programmation est future et dans la fenêtre autorisée.

Le serveur revérifie ces cinq conditions juste avant l'appel au fournisseur de publication.

## 8. Critères de succès du MVP

- 100 % des publications passent par une approbation tracée (vérifiable dans l'audit).
- Une opératrice retrouve une tâche et son contexte en ≤ 3 interactions.
- Zéro identifiant ni donnée personnelle en dépôt ; tests d'accès non autorisé verts.
- Navigation clavier et mobile testées (Playwright + axe-core).
- Les intégrations fonctionnent en mode mock de bout en bout avant tout branchement réel.

## 9. Hors périmètre MVP

Multi-organisation, facturation, publication native par réseau social (hors Buffer), édition collaborative temps réel, application mobile de production de contenu.
