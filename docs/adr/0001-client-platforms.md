# ADR 0001 — Plateformes clientes : web React + Compose Multiplatform (Android, iOS)

- Statut : accepté — 2026-11-05
- Issue : #2

## Contexte

Studio doit être utilisable sur le web (cockpit complet) et sur Android et iPhone (validation en mobilité), en natif et par une seule personne qui développe. Le dépôt possède déjà le socle web React 19 / Vite issu du blueprint AppFactory `react-vite`. AppFactory fournit un blueprint `android-compose` mais aucun blueprint iOS ni multiplateforme.

## Options

1. **Compose Multiplatform partout** (Android, iOS, web via Wasm). Rejeté pour le web : Compose for Web est en Beta (CMP 1.9), le rendu canvas dégrade l'accessibilité et la navigation clavier exigées par #4, et on perdrait le socle `react-vite`.
2. **Trois apps natives** (Compose + SwiftUI + React). Rejeté : trois interfaces à maintenir pour un seul développeur.
3. **React Native / Expo**. Rejeté : ne correspond pas à l'exigence « natif » du commanditaire et n'est pas supporté par AppFactory.
4. **Web React (existant) + Kotlin/Compose Multiplatform pour Android et iOS** avec un module `shared` (domaine, client API, état). Compose Multiplatform est stable sur iOS depuis la version 1.8 (mai 2025).

## Décision

Option 4. Le web reste le cockpit complet ; le mobile couvre un périmètre restreint (Ma journée, À valider, approuver/rejeter, consultation de tâche, notifications push). Les règles métier vivent côté serveur, qui expose `allowedTransitions` pour ne pas dupliquer la logique en Kotlin.

## Conséquences

- Deux bases de code client, pas trois ; le blueprint `android-compose` sert de base, étendu en KMP (contribution amont U4).
- Les builds iOS nécessitent un runner macOS et un compte Apple Developer ; ils sont gardés par l'analyse d'impact et ne s'exécutent que si `apps/mobile` change.
- Le client Kotlin est généré depuis le contrat OpenAPI (ADR 0002).

## Sources

- https://kotlinlang.org/docs/multiplatform/supported-platforms.html
- https://blog.jetbrains.com/kotlin/2025/09/compose-multiplatform-1-9-0-compose-for-web-beta/
