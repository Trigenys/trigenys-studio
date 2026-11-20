# Changelog

## [0.2.0](https://github.com/Trigenys/trigenys-studio/compare/api-v0.1.0...api-v0.2.0) (2026-11-20)


### Features

* **alerts:** inbox d'alertes, acquittement, préférences et notifications e-mail ([#11](https://github.com/Trigenys/trigenys-studio/issues/11)) ([#36](https://github.com/Trigenys/trigenys-studio/issues/36)) ([4db19b2](https://github.com/Trigenys/trigenys-studio/commit/4db19b24ad9a75698346109441f46c893c4f50b5))
* **api:** assignation de tâches notifiée via Trigenys Notify ([#43](https://github.com/Trigenys/trigenys-studio/issues/43)) ([8510ca6](https://github.com/Trigenys/trigenys-studio/commit/8510ca6c6c0b6c5f9089628279193210551e5129))
* **api:** Better Auth identity, RBAC policies and append-only audit ([#22](https://github.com/Trigenys/trigenys-studio/issues/22)) ([fb29f3e](https://github.com/Trigenys/trigenys-studio/commit/fb29f3e777d1f40f83cb37b3710681b1d686a8b6))
* **api:** bootstrap the first production admin from the infrastructure workflow ([#53](https://github.com/Trigenys/trigenys-studio/issues/53)) ([1d10457](https://github.com/Trigenys/trigenys-studio/commit/1d1045746f4117f5593e6b3945b4968c4dc1d7b1))
* **api:** canal WhatsApp de groupe via Trigenys Notify ([#44](https://github.com/Trigenys/trigenys-studio/issues/44)) ([c7504f5](https://github.com/Trigenys/trigenys-studio/commit/c7504f5692dee0bc318625148a483e27e5b6d181))
* **api:** connect MCP clients through Trigenys Auth (OAuth 2.1) ([#58](https://github.com/Trigenys/trigenys-studio/issues/58)) ([92157e3](https://github.com/Trigenys/trigenys-studio/commit/92157e3037d0b9b7d12d302bd66bc3dcd293cd93))
* **api:** editorial pipeline, state machine, approvals bound to content hash and Idempotency-Key ([#23](https://github.com/Trigenys/trigenys-studio/issues/23)) ([8767e64](https://github.com/Trigenys/trigenys-studio/commit/8767e6471384981e3e1a143475d37b8fb096d80b))
* **api:** import the team from the Trigenys Auth directory ([#62](https://github.com/Trigenys/trigenys-studio/issues/62)) ([6ae5a0e](https://github.com/Trigenys/trigenys-studio/commit/6ae5a0e29867aef7e68e873ae94ba40e358694ea))
* **api:** readiness probe with a real database check ([#47](https://github.com/Trigenys/trigenys-studio/issues/47)) ([1f5b8c4](https://github.com/Trigenys/trigenys-studio/commit/1f5b8c4ae03340f4e0ecb5bfcf16906a4bb0fdb6))
* **api:** send branded HTML e-mails for sign-in, assignments and alerts ([#55](https://github.com/Trigenys/trigenys-studio/issues/55)) ([8535ce3](https://github.com/Trigenys/trigenys-studio/commit/8535ce30612cfcd3763016efdfc28aac384889be))
* **api:** serveur MCP en façade des routes REST ([#42](https://github.com/Trigenys/trigenys-studio/issues/42)) ([83c60f1](https://github.com/Trigenys/trigenys-studio/commit/83c60f1c0188257927326928a069b203656b720a))
* **api:** Worker foundation with OpenAPI contract, typed client and integration mocks ([#19](https://github.com/Trigenys/trigenys-studio/issues/19)) ([b357b5b](https://github.com/Trigenys/trigenys-studio/commit/b357b5b170dca76d7ddf2e53b97d497f2178ba8e))
* **editorial:** dossier, sources et assistant contextualisé avec propositions, diff et validation humaine ([#31](https://github.com/Trigenys/trigenys-studio/issues/31)) ([0b45755](https://github.com/Trigenys/trigenys-studio/commit/0b45755bfbc5dfaada8ec7f23060509a0056e210))
* **imports:** entrées du CMS Insight et du radar Editorial OS ([#32](https://github.com/Trigenys/trigenys-studio/issues/32)) ([52f42ce](https://github.com/Trigenys/trigenys-studio/commit/52f42ceaa562c99ccde7522ea437935cc14890dd))
* **infra:** provision the production database through AppFactory ([#45](https://github.com/Trigenys/trigenys-studio/issues/45)) ([674d26b](https://github.com/Trigenys/trigenys-studio/commit/674d26b5afec3fd898a74425e2ed398644607c6f))
* **infra:** release the production Worker through AppFactory ([#46](https://github.com/Trigenys/trigenys-studio/issues/46)) ([033e952](https://github.com/Trigenys/trigenys-studio/commit/033e95204ea66681627c86b3c1d976cb632b94c7))
* **publishing:** calendrier, livraisons via Buffer et comptes sociaux ([#9](https://github.com/Trigenys/trigenys-studio/issues/9)) ([#34](https://github.com/Trigenys/trigenys-studio/issues/34)) ([39034c4](https://github.com/Trigenys/trigenys-studio/commit/39034c4782bdc7ef39020100546976e6bc080281))
* **release:** Visual QA gate, axe checks, mobile release component and operations runbook ([#29](https://github.com/Trigenys/trigenys-studio/issues/29)) ([9d7733e](https://github.com/Trigenys/trigenys-studio/commit/9d7733e3098e4ce7ad7121d1bdf158945b31c9b7))
* **reporting:** rapport éditorial mensuel, objectifs de contrat et mesures vérifiées ([#10](https://github.com/Trigenys/trigenys-studio/issues/10)) ([#35](https://github.com/Trigenys/trigenys-studio/issues/35)) ([dcd9482](https://github.com/Trigenys/trigenys-studio/commit/dcd9482481aaaf0da6739addf016a3ef88918067))
* **visuals:** pipeline visuel déterministe et kits de marque versionnés ([#33](https://github.com/Trigenys/trigenys-studio/issues/33)) ([579f2eb](https://github.com/Trigenys/trigenys-studio/commit/579f2eb6f30f8943c5deb65ea85d79bbabbd5523))
* **web:** "Ma journée" dashboard shell, product filter, views, search and task page ([#24](https://github.com/Trigenys/trigenys-studio/issues/24)) ([e4dbff4](https://github.com/Trigenys/trigenys-studio/commit/e4dbff41a318c0315fdfd671126179ed3f737cc2))
* **web:** editorial flow — create tasks, write versions, comment, send back with a reason ([#26](https://github.com/Trigenys/trigenys-studio/issues/26)) ([5650b7a](https://github.com/Trigenys/trigenys-studio/commit/5650b7ae98813ef1d8f40dc1b9de433e7dbf6f43))
* **web:** serve the web app from the production Worker and send live notifications ([#48](https://github.com/Trigenys/trigenys-studio/issues/48)) ([bf8a179](https://github.com/Trigenys/trigenys-studio/commit/bf8a179967f05e1d89ae423df9e011846523e223))


### Bug Fixes

* **api:** accept OAuth access tokens on MCP from hosted clients' origins ([#59](https://github.com/Trigenys/trigenys-studio/issues/59)) ([18842e8](https://github.com/Trigenys/trigenys-studio/commit/18842e81a298cd9b74835b813efcaf4556886e1c))
* **api:** allow the Worker to fetch Notify on the same account ([#52](https://github.com/Trigenys/trigenys-studio/issues/52)) ([596f1c3](https://github.com/Trigenys/trigenys-studio/commit/596f1c371549cfd762ddf5a4de6805ff9ad8d3a2))
* **api:** bind ISO bounds in the editorial report; add MCP editing tools ([#61](https://github.com/Trigenys/trigenys-studio/issues/61)) ([936b609](https://github.com/Trigenys/trigenys-studio/commit/936b609604b5cd5cc7028d9f9f616973cd3b97a4))
* **api:** connect the admin bootstrap over TLS like the migrations ([#54](https://github.com/Trigenys/trigenys-studio/issues/54)) ([f1f66a1](https://github.com/Trigenys/trigenys-studio/commit/f1f66a1174fbb410a1e9eb1faee220e874004eea))
* **api:** install the web workspace before building it in the Worker recipe ([#49](https://github.com/Trigenys/trigenys-studio/issues/49)) ([8e3656b](https://github.com/Trigenys/trigenys-studio/commit/8e3656bfc3be13ab933b8552532c17d994464c98))
* **api:** return MCP transport refusals instead of a 500 ([#60](https://github.com/Trigenys/trigenys-studio/issues/60)) ([384d87f](https://github.com/Trigenys/trigenys-studio/commit/384d87ff9f283836b078c901a6198f2e27830e59))
* **integrations:** call the global fetch unbound in HTTP adapters ([#51](https://github.com/Trigenys/trigenys-studio/issues/51)) ([504cf90](https://github.com/Trigenys/trigenys-studio/commit/504cf902850253c80626ffa62c84aba519a4901b))
* **web:** proxier toutes les routes API en dev et documenter le test local ([#38](https://github.com/Trigenys/trigenys-studio/issues/38)) ([f1b025c](https://github.com/Trigenys/trigenys-studio/commit/f1b025c5c686e0f4a4791fd91d7c234288014f3f))
