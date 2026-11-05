# ADR 0006 — Dossier éditorial et assistant contextualisé

Statut : accepté · Date : 2026-11-05 · Issue : #6

## Contexte

Un contenu se rédige à partir d'un brief, de sources et des versions précédentes. L'assistant
doit proposer, corriger, synthétiser ou décliner un texte à partir de ce dossier, sans jamais
remplacer silencieusement une version approuvée, et chaque intervention doit être tracée.

## Décision

1. **Le dossier est une donnée de la tâche.** `task_source` (titre, lien, note, origine
   `manual|radar|cms`) est lu par tous les rôles de contenu et écrit par les writers. Les
   origines `radar` et `cms` sont réservées aux prochains incréments (veille, import CMS).
2. **Toute intervention est une proposition.** `POST /tasks/{id}/assistant` crée une
   `ai_interaction` (`proposed`) avec le prompt haché, les références de contexte
   (`task:`, `source:`, `version:`), le modèle et les jetons. Le contenu n'est pas modifié.
3. **Accepter = écrire une version par le pipeline.** `…/accept` passe par `insertVersion`,
   la même fonction que la rédaction manuelle : version `n+1` marquée `aiAssisted`, hash de
   contenu, et retour en `preparing` si une approbation couvrait la version précédente
   (`invalidatedBy`). Les états gelés refusent (409). `…/dismiss` écarte sans effet.
4. **Le diff précède la décision.** Le web affiche la proposition en différence de lignes
   avec la version courante (`apps/web/src/diff.ts`, LCS maison, aucune dépendance).
5. **Adaptateur LLM derrière `Integrations.llm`.** `INTEGRATION_LLM_MODE=mock` par défaut ;
   `live` exige le secret Worker `ANTHROPIC_API_KEY` (jamais une `var`) et accepte `LLM_MODEL`.
   L'adaptateur Anthropic utilise le SDK officiel avec repli serveur (`fallbacks: "default"`) ;
   un refus devient 422, une panne fournisseur 502/429, sans texte inventé.
6. **Journal.** `source.add`, `source.remove`, `ai.interact`, `content.version` (avec
   `aiInteractionId`) et `ai.dismiss` sont des événements d'audit liés à la tâche.

## Alternatives écartées

- Faire écrire la version directement par l'assistant : contredit le critère « contrôle humain ».
- Diff par bibliothèque (`diff`, `jsdiff`) : 40 lignes suffisent pour des textes éditoriaux,
  et le bundle web reste sans dépendance supplémentaire.
- Appel direct depuis le web au fournisseur : clé exposée, aucun journal côté serveur.

## Conséquences

- Les clients mobiles consomment les mêmes routes (`dossier` dans `openapi.json`).
- Un changement de fournisseur se fait par un nouvel adaptateur `Llm`, sans toucher aux routes.
- Les coûts (jetons) sont consignés par interaction pour un futur tableau de bord.
