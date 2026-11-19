# ADR 0014 — Canal WhatsApp de groupe via Trigenys Notify

Statut : accepté · Date : 2026-11-19 · Issue : — (demande directe, suite de l'ADR 0013)

## Contexte

L'ADR 0013 prévient la prestataire par e-mail à chaque assignation. Le commanditaire veut aussi
une notification WhatsApp. Trigenys Notify expose désormais une route générique
`POST /v1/dispatch/{project}/whatsapp` (Trigenys/trigenys-notify#61, contrat v1) : l'événement
ne porte aucun destinataire, Notify le poste dans **le groupe déclaré pour le projet**
(`WHATSAPP_PROJECTS_JSON`), avec une clé produit dédiée, un lien `https` limité aux origines
autorisées et une empreinte HMAC de tout l'événement (même id + contenu différent = 409).

## Décision

- **Port `GroupMessenger`** (`src/integrations/types.ts`) : `send({ text, link?, linkLabel?, key })`,
  sans destinataire. Adaptateurs : `MockGroupMessenger` (défaut, journalise en dev) et
  `NotifyWhatsApp` (`src/integrations/notify/whatsapp.ts`).
- **Outbox existante (ADR 0011)** : la colonne `channel` de `notification_dispatch` prend
  `whatsapp` ; aucune migration. À l'assignation, une ligne par canal dans la même transaction ;
  la clé de dédoublonnage e-mail est inchangée, celle du groupe est `task_assigned:whatsapp:…`.
- **Opt-in** : `WHATSAPP_NOTIFY_EVENTS` (liste séparée par des virgules, aujourd'hui
  `task_assigned`) ; vide = aucune ligne WhatsApp, comportement actuel conservé.
  `INTEGRATION_WHATSAPP_MODE` (`mock` | `live`) choisit l'adaptateur.
- **Contrat v1** : id = SHA-256 de `projet:whatsapp:dispatchId:tentative`, donc stable pour un
  rejeu HTTP d'une même tentative et neuf à chaque nouvelle tentative (Notify refuse un
  événement de plus de 5 minutes et un contenu différent sous le même id). Expiration 24 h.
  Texte nettoyé (contrôles retirés, retours à la ligne gardés) et tronqué à 2000 caractères ;
  lien abandonné s'il n'est pas `https` ou dépasse 1024 caractères ; libellé sur une ligne.
- **Confidentialité** : le message de groupe ne contient ni adresse e-mail ni brief :
  « Nouvelle tâche pour <nom> : <titre> / Produit / Échéance » et le lien vers la tâche.
  En erreur, seuls le statut HTTP et le code Notify (`^[A-Z_]{1,64}$`) remontent, jamais le corps.
- **Sans messager configuré**, une ligne WhatsApp est `skipped` (auditée), jamais envoyée par
  e-mail ; un canal inconnu est aussi `skipped`.

## Conséquences

- Activation (aucune action automatique, toutes sur accord du propriétaire) :
  1. créer le groupe « Studio Comm » avec le compte de la session WAHA et y ajouter la
     prestataire ; lire son id `@g.us` (`GET /v1/whatsapp/groups` de Notify) ;
  2. générer une clé : secret Notify `WHATSAPP_TRIGENYS_STUDIO_INGEST_KEY`, même valeur en
     secret Studio `NOTIFY_WHATSAPP_INGEST_KEY` ;
  3. PR revue sur Notify : `trigenys-studio` activé dans `WHATSAPP_PROJECTS_JSON` (groupe,
     `allowedLinkOrigins` = origine de `WEB_APP_URL`) ;
  4. Studio : `INTEGRATION_WHATSAPP_MODE=live`, `WHATSAPP_NOTIFY_EVENTS=task_assigned`
     (`NOTIFY_WHATSAPP_BASE_URL` facultative, sinon `NOTIFY_EMAIL_BASE_URL`) ; tester un envoi.
- Comme pour les autres intégrations, `INTEGRATION_WHATSAPP_MODE=live` sans clé ni base fait
  échouer la création des intégrations (erreur explicite `IntegrationNotAvailableError`).
- Tant que Notify garde le projet désactivé, les envois échouent en 503 `CHANNEL_DISABLED`,
  réessayés puis abandonnés par l'outbox ; l'e-mail n'est pas affecté.
- Les alertes ont déjà un `groupText` ; les publier dans le groupe demandera seulement un nouvel
  événement dans `WHATSAPP_NOTIFY_EVENTS`.
