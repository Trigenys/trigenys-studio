# ADR 0017 — Stockage durable des logos et visuels

Statut : accepté · Date : 2026-11-19

## Contexte

La configuration de production gardait les médias en `mock`, sans binding R2.
`createIntegrations` est appelé à chaque requête et crée alors un nouveau
`MemoryMediaStore`. Un import de logo répondait 201 et conservait ses métadonnées
dans Postgres, mais l'appel suivant répondait 404 ; rendre un visuel avec le kit
approuvé échouait ensuite en 409. Les tests existants injectaient un même stockage
mémoire partagé, ce qui masquait ce défaut de configuration.

## Décision

- Activer l'adaptateur `R2MediaStore` existant : `INTEGRATION_MEDIA_MODE=live` et
  binding `VISUALS` vers le bucket privé `trigenys-studio-media` en production.
- Utiliser la recette AppFactory `private-media` dans `.appfactory/worker.json`.
  La release du Worker (`/infrastructure/worker`) crée ou réutilise le bucket dans
  Workers Builds, avec le jeton de build enregistré qui a accès à R2. Le workflow
  ne passe que si ce build est terminé et que le bucket attendu est rapporté.
  Pas d'appel direct à `/infrastructure/r2` : les jetons d'exécution d'AppFactory
  n'ont pas accès à l'API R2 (`CLOUDFLARE_R2_ACCESS_DENIED`, voir Trigenys/appfactory#130).
- En développement, utiliser le binding R2 local déjà déclaré, avec l'adaptateur
  R2 activé. Wrangler simule le bucket localement ; aucune requête média n'atteint
  le bucket distant.
- Conserver les routes de lecture et leurs contrôles de session et de produit.
  Aucun domaine public ni identifiant de stockage n'est ajouté.

## Vérification et conséquences

`test/media-persistence.test.ts` utilise le mode média et le binding de la vraie
configuration de production, l'adaptateur R2 existant et un bucket de test dont
la durée de vie dépasse celle des requêtes. Il importe un logo, recrée
l'application à chaque appel, approuve le kit, rend et relit un visuel, puis
vérifie que ces fichiers restent inaccessibles sans session. Il reproduit le
404 avant correction, sans le stockage mémoire partagé du harness.

Ce changement ne peut pas récupérer les octets déjà perdus en mode `mock`.
Pour un ancien kit concerné, importer une nouvelle version avec le fichier
original, l'approuver puis régénérer les visuels ; les approbations affectées
suivent les règles d'invalidation existantes.
