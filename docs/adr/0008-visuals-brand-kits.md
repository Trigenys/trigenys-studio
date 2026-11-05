# ADR 0008 — Pipeline visuel et kits de marque

Statut : accepté · Date : 2026-11-05 · Issue : #8

## Contexte

Chaque contenu publié a besoin de visuels (OG d'article, carte LinkedIn, carré Instagram,
story) cohérents avec l'identité du produit. Trigenys Insight produit déjà des images OG à la
demande (route satori), mais à la volée, sans mémoire, et sans lien avec une approbation. Le
Studio doit rendre des visuels reproductibles, les conserver, et faire tomber une approbation
quand le jeu d'actifs change (le moteur suivait déjà `assetSetHash`, jusqu'ici toujours vide).

## Décision

- **Rendu déterministe côté Worker, sans dépendance native.** Moteur `svg@1`
  (`visuals/svg-renderer.ts`) : un SVG construit à partir d'une entrée canonique
  (titre, sous-titre, format, palette, logo encodé, variante). Même entrée → mêmes octets
  → même `content_hash`. Adapt de la route OG d'Insight : même grammaire visuelle, mais
  sans satori/resvg (wasm non disponible sous Workers sans bundling spécifique) et sans
  réseau. La conversion PNG, si un canal l'exige, sera un renderer supplémentaire
  (`renderer` est stocké sur chaque actif).
- **Kits de marque versionnés et immuables.** `brand_kit` porte palette, police, mentions,
  logo (octets hashés, 256 Ko max, SVG ou PNG vérifié par signature) et `kit_hash`. Un seul
  kit `approved` par produit ; approuver un nouveau kit retire le précédent. Un visuel
  référence le kit et son hash : on sait toujours avec quelle identité il a été rendu.
- **Actifs adressés par contenu, écart logique.** `visual_asset` est dédupliqué par
  `(task, content_hash)` parmi les actifs actifs : rejouer un rendu identique renvoie l'actif
  existant (200), un rendu différent crée une variante. `DELETE` marque `discarded` sans
  supprimer l'objet. Les octets vivent dans un `MediaStore` : bucket R2 privé `VISUALS` en
  `live`, mémoire en `mock`/tests ; clés `visuals/sha256/<hash>.svg`, `logos/sha256/<hash>.*`.
- **Approbation liée aux actifs.** `assetSetHashOf` hashe désormais les actifs actifs
  (format, hash) ; le jeu vide conserve `sha256("[]")` pour ne pas invalider les approbations
  existantes. Rendre ou écarter après approbation renvoie la tâche en `preparing`.
- **Formats configurables.** `visual_format` seedé (article, linkedin, instagram, story),
  modifiable par un admin (`PUT /visual-formats/{id}`, idempotent, désactivation logique).
- **Fichiers servis derrière la session.** `/visuals/{id}/file` et `/brand-kits/{id}/logo`
  répondent avec `ETag`, `immutable`, `nosniff` et une CSP `sandbox` (un SVG est exécutable) ;
  le web les affiche via un object URL chargé avec `credentials: include`.

## Conséquences

- Le hash d'un visuel est vérifiable depuis l'extérieur ; le même brief, kit et format
  redonneront le même fichier sur n'importe quel environnement.
- Une intégrité rompue dans le stockage (logo absent ou altéré) bloque le rendu avec un 409
  explicite au lieu de produire un visuel faux.
- Non couvert : export PNG/JPEG (renderer à venir), kits éditables en place (créer un nouveau
  kit), génération d'images par modèle (hors périmètre, le rendu reste typographique).
