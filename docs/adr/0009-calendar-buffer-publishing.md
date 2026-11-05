# ADR 0009 — Calendrier, publication via Buffer et comptes sociaux

Statut : accepté · Date : 2026-11-05 · Issue : #9

## Contexte

Une tâche approuvée doit partir sur un réseau social à une date choisie, sans que l'opérateur
ait à se reconnecter à chaque plateforme. Le Studio ne possède pas les intégrations réseaux
(LinkedIn, X, Instagram…) : un intermédiaire de publication s'en charge. Il faut aussi savoir,
pour un produit donné, sur quel compte on publie, et voir le mois d'un coup d'œil (publications
planifiées, échéances). Le moteur de pipeline savait déjà passer `approved → scheduled →
published | failed`, mais rien ne déclenchait ces transitions.

## Décision

- **Un intermédiaire, derrière un port.** Le port `Publisher` (`integrations/types.ts`) expose
  `listChannels`, `createPost`, `deletePost`, `lookup`. Deux adaptateurs : `mock` (horloge
  simulée, pannes scriptées pour les tests) et `buffer` (API GraphQL de Buffer, `createPost`
  avec `schedulingType: automatic`, Bearer `BUFFER_API_KEY`). Le choix se fait par
  `INTEGRATION_PUBLISHER_MODE`, comme les autres intégrations. Rien dans le domaine ne connaît
  Buffer.
- **Comptes sociaux explicites.** `social_account` relie un produit et un canal à la référence
  que le fournisseur connaît (`external_ref`). Un compte n'est jamais supprimé : les livraisons
  le référencent ; un administrateur le désactive. Unicité `(product, provider, external_ref)`.
- **Canal strict, pas de cross-post implicite.** Une livraison n'est acceptée que si le canal du
  compte égale le canal de la dernière version du contenu. Publier le même texte sur un autre
  réseau est une autre version, donc une autre approbation.
- **Outbox transactionnelle en trois temps.** `delivery` est la file : `draft | scheduled |
  sending | handed_off | sent | failed | cancelled`. Le cron (toutes les 5 minutes) ou l'appel
  manuel `POST /deliveries/dispatch` (1) **réclame** en transaction les livraisons dues (date −
  `PUBLISH_LEAD_MINUTES`) avec un bail (`claimed_until`), (2) appelle le fournisseur **hors
  transaction**, (3) **enregistre** l'issue et la tentative (`delivery_attempt`) en transaction.
  Aucune requête réseau sous verrou ; une livraison trouvée `sending` au-delà de son bail est
  réconciliée par `lookup` avant tout renvoi, pour ne jamais publier deux fois.
- **Reprise bornée.** Erreur réexécutable → nouvel essai avec repli exponentiel plafonné à
  60 minutes (ou `Retry-After`), jusqu'à `max_attempts` (5) ; au-delà ou sur erreur fatale →
  `failed`, et la tâche passe en `failed`. « Réessayer » rouvre trois tentatives.
- **La tâche suit ses livraisons.** Première livraison programmée → `scheduled` ; toutes
  annulées sans envoi → **nouvelle transition `scheduled → approved`** (action `content.publish`,
  garde `approval_valid`) ; publiée → `published` ; abandonnée → `failed`.
- **Préparation vérifiée côté serveur.** `GET /tasks/{id}/publish-readiness` renvoie cinq
  vérifications nommées (état, approbation, compte, droits, créneau entre maintenant et 90 jours)
  avec une raison ; le web ne fait que refléter ce verdict.
- **Calendrier en liste.** `GET /calendar?from&to` agrège livraisons et échéances ; l'écran
  les groupe par jour, un mois à la fois, filtrable par produit. Une liste se lit sur mobile et
  au lecteur d'écran, là où une grille de sept colonnes ne se lit pas.
- **Droits.** `social.read` (tous les rôles), `social.manage` (admin), `delivery.dispatch`
  (admin, cron hors RBAC). Planifier, décaler, annuler, réessayer passent par `content.publish`
  sur le produit.

## Conséquences

- Les secrets du fournisseur ne vivent que comme *Worker secrets* ; ils ne sont jamais
  journalisés ni renvoyés par l'API. En mode `mock`, aucun réseau.
- L'API de Buffer étant en bêta, le contrat réel (`shareNow`, suppression, permalien) est à
  confirmer lors du premier passage en `live` ; l'adaptateur est isolé pour ça.
- Buffer n'offre pas d'idempotence : deux `createPost` identiques créeraient deux posts. La
  réconciliation par `lookup` couvre le cas du bail expiré ; un doute restant finit en `failed`
  avec motif « vérification manuelle », jamais en renvoi aveugle.
- Les heures sont stockées en UTC et affichées en heure locale ; le calendrier groupe par jour
  local.
- Métriques de publication (#10) et autres fournisseurs se brancheront sur le même port.
