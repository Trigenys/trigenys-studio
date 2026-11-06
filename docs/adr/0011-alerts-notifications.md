# ADR 0011 — Alertes dérivées, inbox d'exceptions et notifications e-mail

Statut : accepté · Date : 2026-11-06 · Issue : #11

## Contexte

La responsable de la validation doit voir ce qui demande une décision — tâche en retard ou sans
activité, contenu renvoyé en correction, approbation qui traîne, publication refusée par le
fournisseur — sans multiplier les outils ni recevoir d'alertes parasites. Chaque alerte doit
renvoyer à une tâche corrigeable, et les envois d'e-mail comme leurs échecs doivent être audités.
Le risque principal est double : des alertes créées à la main qui ne reflètent plus l'état réel,
et un flux d'e-mails répétés à chaque passage du cron.

## Décision

- **Une alerte est un état dérivé, jamais saisi.** Le module `alerts/reconcile.ts` est le seul
  écrivain de la table `alert` : il lit les faits (tâches, transitions, versions, commentaires,
  livraisons), calcule les alertes désirées via `alerts/rules.ts`, les compare aux alertes non
  résolues et n'écrit que la différence. Un second passage sur des données inchangées n'écrit
  rien. Une alerte dont la condition disparaît est résolue par le réconciliateur, jamais par un
  utilisateur : il n'y a pas de résolution manuelle, seulement un acquittement.
- **Quatre types, une alerte par tâche au plus.** `content_fix` (needs_fix / rejected),
  `approval_required` (awaiting_approval depuis plus de `ALERT_APPROVAL_HOURS`), `task_blocked`
  (échéance dépassée, ou aucune activité depuis `ALERT_STALL_HOURS` en préparation),
  `publication_failed` (une livraison `failed`, une alerte par livraison). Précédence au niveau
  tâche : contenu à corriger > approbation requise > retard > inactivité. Priorité p1/p2/p3 par
  règle (p1 quand l'échéance est à moins de `ALERT_DUE_SOON_HOURS`). Dédoublonnage par index
  partiel unique sur `dedup_key` tant que `state <> 'resolved'` ; une alerte résolue puis
  réapparue est une nouvelle ligne.
- **Rien dérivé de « maintenant » dans une alerte.** Titres, détails et `facts` ne portent que
  des dates fixes (échéance, entrée en attente, dernière activité) et jamais une durée écoulée :
  sinon chaque passage réécrirait la ligne et le réconciliateur ne convergerait pas.
- **Acquittement et escalade.** `POST /alerts/{id}/acknowledge` passe une alerte ouverte en
  `acknowledged` (idempotent, 409 si résolue). Une montée de priorité la rouvre : c'est une
  nouvelle information, à acquitter de nouveau. Une baisse de priorité ou un changement de texte
  met à jour en silence.
- **E-mails : outbox at-most-once.** À l'ouverture et à l'escalade, une ligne
  `notification_dispatch` est insérée par destinataire de l'audience du type (rôles admin /
  opérateur / relecteur sur le produit ou globaux) dont la préférence effective est `immediate`,
  avec `dedup_key (alert, user, canal, priorité)`. `alerts/notify.ts` reprend les trois phases de
  l'outbox de publication : réclamer sous verrou avec un bail, envoyer hors transaction,
  enregistrer. Trois tentatives avec backoff ; un bail expiré sans compte rendu est classé
  `failed` « incertain » et jamais renvoyé. Chaque tentative, saut ou échec laisse un audit
  `notification.send` sans adresse e-mail. Une alerte acquittée ou résolue avant l'envoi n'est
  pas envoyée. Sans `WEB_APP_URL`, rien ne part : un e-mail sans lien vers la tâche est inutile.
- **Premier passage silencieux.** Tant qu'aucun audit `alert.reconcile` n'existe, les alertes
  s'ouvrent sans e-mail : un arriéré au déploiement n'est pas une nouvelle.
- **Préférences par utilisateur.** `notification_preference (user, kind, email off|immediate)` ;
  les défauts vivent dans `ALERT_RULES` (immédiat pour approbation requise et publication refusée,
  off pour les autres) et `GET /me/notification-preferences` renvoie toujours les quatre types
  avec leur `source` (`default` | `user`). Les alertes restent visibles dans l'inbox quelle que
  soit la préférence.
- **Déclenchement.** Le cron existant enchaîne outbox de publication → réconciliation globale →
  envoi des notifications. Les routes qui changent l'état d'une tâche ou d'une livraison lancent
  une réconciliation ciblée sur cette tâche, en best-effort : un échec est journalisé et ne fait
  pas échouer la requête. `POST /alerts/reconcile` (admin) force un passage complet.
- **RBAC.** `alert.read` et `alert.acknowledge` pour admin, opérateur, relecteur sur leurs
  produits ; `alert.reconcile` admin.
- **Web.** Page `/alerts` : filtres état / priorité / produit dans l'URL, chaque carte lie la
  tâche (et son bloc publication pour une livraison refusée), bouton « Acquitter », mention
  « E-mail non remis » quand le dernier envoi a échoué, préférences repliables, « Vérifier
  maintenant » pour l'admin. Le tableau de bord compte les alertes à traiter.

## Conséquences

- Pas d'alerte parasite : une alerte existe exactement tant que sa condition est vraie, et une
  même condition ne produit qu'une ligne et qu'un e-mail par priorité atteinte.
- Les e-mails dépendent d'une adresse sur l'utilisateur et d'un `WEB_APP_URL` configuré ; sans
  eux l'audit explique pourquoi rien n'est parti.
- La réconciliation globale lit toutes les tâches à chaque passage du cron ; acceptable au volume
  du Studio, à borner par produit si le volume grandit.
- Les imports en erreur ne produisent pas d'alerte : aucun fait d'erreur n'est stocké côté
  imports aujourd'hui.

## Alternatives écartées

- **Alertes créées par les routes métier** : chaque route devrait connaître toutes les règles et
  penser à résoudre ; incohérent dès qu'une règle change ou qu'un cas est oublié.
- **E-mail envoyé directement dans la transaction de réconciliation** : un envoi réussi puis un
  rollback renverrait le même message ; l'outbox sépare décision et remise.
- **Service de notifications tiers** : rien de plus qu'un port `Mailer` n'est nécessaire au volume
  du Studio ; les retries et l'audit restent dans le code.
