# Trigenys Studio — client mobile

Kotlin Multiplatform + Compose Multiplatform. Même vues, même vocabulaire et mêmes
règles que le client web : le serveur reste l'autorité (`allowedTransitions`, RBAC,
Problem Details affichés tels quels).

```
apps/mobile/
├── shared/      logique et écrans communs (commonMain), tests communs (commonTest)
│   ├── api/     DTO miroir de packages/contracts/openapi.json + client ktor
│   ├── auth/    jeton de session (TokenStore), extraction du lien magique
│   ├── domain/  vues « Aujourd'hui / À valider / En retard », tri, libellés
│   └── ui/      AppModel (StateFlow), thème, écrans Compose
└── androidApp/  application Android (MainActivity, App Link, stockage du jeton)
```

Le build Gradle est indépendant du monorepo npm (ADR 0003) ; il n'y a pas de
wrapper : la CI installe Gradle via `gradle/actions/setup-gradle`.

## Commandes

```bash
gradle -p apps/mobile :shared:testAndroidHostTest          # tests communs (JVM)
gradle -p apps/mobile :androidApp:testDebugUnitTest -Proborazzi.test.record=true   # Roborazzi, PNG dans src/test/screenshots
gradle -p apps/mobile :androidApp:assembleDebug -PstudioApiUrl=https://api.example.com
gradle -p apps/mobile :shared:linkDebugFrameworkIosSimulatorArm64   # macOS uniquement
```

`studioApiUrl` (gradle.properties ou `-P`) fixe l'URL du Worker compilée dans l'APK et
l'hôte du filtre App Link `/api/auth/magic-link/verify`. Par défaut : `http://10.0.2.2:8787`
(un `wrangler dev` local vu depuis l'émulateur).

## Connexion

1. L'utilisateur saisit son e-mail ; l'app appelle `POST /api/auth/sign-in/magic-link`.
2. Le lien reçu ouvre l'app (App Link) ou est collé ; l'app appelle
   `GET /api/auth/magic-link/verify?token=…` et conserve le jeton `set-auth-token`
   (plugin bearer de Better Auth) dans les préférences privées.
3. Chaque appel porte `Authorization: Bearer …` ; les mutations portent un
   `Idempotency-Key` neuf.

## iOS

Les cibles `iosArm64` / `iosSimulatorArm64` produisent le framework `Shared` (lié en CI sur
macOS). Le projet Xcode et la publication exigent un Mac et un compte Apple : hors de ce
dépôt pour l'instant.
