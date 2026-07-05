# 2026-07-05 — Remediation program closeout & e2e environment blockers

> Назначение: этот документ фиксирует итог remediation-программы по полному ревью
> `2026-06-27-full-project-review.md` и — главное для других агентов — **известные
> блокеры окружения** и **рабочий runbook для e2e**, чтобы никто не тратил время на
> уже пройденные тупики.

> **ОБНОВЛЕНИЕ 2026-07-05 (позднее): блокер обойдён, e2e 8/8 на этом хосте.**
> См. [раздел 7](#7-обход-блокера-prod-режим-e2e-и-итог-диагностики): добавлен
> `npm run test:e2e:prod` (последовательные сборки + `next start`, без компиляции
> во время тестов). Диагноз «2 интерактивных теста не проходят из-за среды»
> опровергнут: после снятия компиляции из горячего цикла оказалось, что тесты
> падали из-за устаревших ожиданий спека (нормализация экранов Antarctica,
> имя кнопки simple-choice) и перехвата кликов открытой JSON-панелью.
> Разделы 3–4 и 6 сохранены как история диагностики; их выводы про `next dev`
> на 4 ядрах остаются в силе, а вывод «нужна машина ≥8 ядер» — снят.

## Оглавление

- [1. Итог программы](#1-итог-программы)
- [2. Как запускать e2e на этом хосте (runbook)](#2-как-запускать-e2e-на-этом-хосте-runbook)
- [3. Блокер: editor e2e и Next.js-компиляция под нагрузкой](#3-блокер-editor-e2e-и-nextjs-компиляция-под-нагрузкой)
- [4. Почему 2 интерактивных editor-preview теста не проходят](#4-почему-2-интерактивных-editor-preview-теста-не-проходят)
- [5. Прочие baseline-блокеры (не регрессии)](#5-прочие-baseline-блокеры-не-регрессии)
- [6. Единственная незакрытая задача: EditorWorkspace Phase 4](#6-единственная-незакрытая-задача-editorworkspace-phase-4)
- [7. Обход блокера: prod-режим e2e и итог диагностики](#7-обход-блокера-prod-режим-e2e-и-итог-диагностики)

## 1. Итог программы

Ветка `p0-review-remediation-correctness` (11 коммитов, влита в `main` 2026-07-05).
Закрыто 9 из 10 задач блока `TSK-20260630-*` + `LEGACY-0016`:

| Задача | Статус | Проверка |
| --- | --- | --- |
| P0 correctness (7 дефектов) | ✅ done | editor-engine 38 · player-web 130 · runtime-api 127 · editor-web 105 |
| Manifest contract parity (ADR-056) | ✅ done | schema→TS drift check + 9 contract tests + typed `overrides` |
| Editor-engine modularization | ✅ Ph1-3 (Ph4 — см. §6) | 5428 строк → фасад + 14 модулей; 127 экспортов сохранены |
| Player renderer purity (ADR-055) | ✅ done, **e2e-verified** | все 3 sub-part; player e2e 4/4 в браузере |
| Codebase cleanup (SDK/JsonLogic) | ✅ done | агрегатный `npm test --workspaces` зелёный |
| Guard reconciliation (ADR-041 §7.2) | ✅ done | все 4 guard-а → generic; runtime-api 127 |
| JSON Schema strict (LEGACY-0016) | ✅ done | 7 валидаторов `strict:true`; 2 bounded exceptions |
| Player-web dead code + strict flags | ✅ done | `noUnusedLocals/Parameters` включены |

**LEGACY-0020/0022 → archived; 0016/0021 обновлены.**

## 2. Как запускать e2e на этом хосте (runbook)

`playwright.config.ts` по умолчанию стартует **3 dev-сервера** (runtime 3201, player
3200, editor 3202) внутри playwright, каждый с таймаутом 120с. На этом боксе это **не
укладывается** (см. §3). Рабочий способ — **поднять сервисы заранее** и использовать
минимальный конфиг без `webServer` (playwright переиспользует живые серверы, т.к.
`reuseExistingServer: !process.env.CI`).

### Player e2e (работает, 4/4 зелёный)

```bash
# 1. runtime + player в фоне (nohup — переживает завершение bash-вызова)
PORT=3201 CUBICA_ENABLE_MOCK_AGENT_RUNTIME=false setsid nohup \
  npm run dev --workspace services/runtime-api >/tmp/rt.log 2>&1 </dev/null &
PORT=3200 RUNTIME_API_URL=http://127.0.0.1:3201 PLAYER_WEB_URL=http://127.0.0.1:3200 \
  NEXT_IGNORE_INCORRECT_LOCKFILE=1 setsid nohup \
  npm run dev --workspace @cubica/player-web -- --hostname 127.0.0.1 >/tmp/pw.log 2>&1 </dev/null &
# 2. дождаться http://127.0.0.1:3201/health = 200 и http://127.0.0.1:3200/ = 200
# 3. запустить спек против живых серверов минимальным конфигом (baseURL=player, без webServer)
npx playwright test --config <minimal.config.ts> --reporter=line
```

### Editor e2e (частично: 2/4, см. §3–4)

editor **нельзя** запускать через `next dev` здесь (падает, §3) — только **production**:

```bash
# один раз собрать editor В ОДИНОЧКУ (без параллельных dev-серверов, иначе SIGTERM):
npm run build --workspace @cubica/editor-web
# подготовить editor project root (games+docs/schemas+scripts/manifest-tools + git init/commit)
# как prepareEditorProjectRoot() в playwright.config.ts → .tmp/e2e-editor-project
# ВАЖНО: runtime нужно стартовать с EDITOR_PREVIEW_WORKTREES_ROOTS, иначе preview
#   вернёт "contentRoot must point to a local editor preview worktree":
EDITOR_PREVIEW_WORKTREES_ROOTS="<repo>/.tmp/editor-worktrees:<projectRoot>/.tmp/editor-worktrees"
# editor в production:
PORT=3202 EDITOR_PROJECT_ROOT=<projectRoot> ... npm run start --workspace @cubica/editor-web -- -p 3202
# затем editor-спек с env E2E_EDITOR_URL/E2E_RUNTIME_URL/E2E_EDITOR_PROJECT_ROOT
```

## 3. Блокер: editor e2e и Next.js-компиляция под нагрузкой

Хост: **4 ядра (`nproc`=4), load average ~3**, ~7.8 GB RAM.

Наблюдения (диагностировано эмпирически):

1. **`editor-web` `next dev` стабильно умирает на «Compiling / ...»** — процесс
   завершается тихо (без ошибки в логе, без роста памяти → **не OOM**). Воспроизводится
   с `nohup`, `setsid`, `--max-old-space-size=3072`, и даже когда runtime+player
   погашены (память свободна ~3.4 GB). Причина — Next-компилятор/воркер получает
   **SIGTERM** под нагрузкой на 4 ядрах (тяжёлый editor-бандл с Monaco).
2. **`next build` editor** под параллельными dev-серверами: `Static worker exited with
   code: null and signal: SIGTERM`. **В одиночку `next build` проходит (exit 0).** →
   Значит блокер — **конкуренция за CPU/процессы**, а не код (код собирается).
3. **Обход:** editor запускается только в **production-режиме** (`next start` — компиляция
   уже сделана на build-шаге, рантайм низко-CPU). В этом режиме editor стабилен (Ready
   ~760 ms), 2 из 4 e2e-тестов проходят.

**Вывод для агентов:** на этом боксе не пытайтесь поднимать `editor-web` через
`next dev` и не запускайте `next build` editor одновременно с другими dev-серверами.
Используйте `next build` (в одиночку) + `next start`. На машине с ≥8 ядрами ограничение,
скорее всего, снимется.

## 4. Почему 2 интерактивных editor-preview теста не проходят

Спек `apps/editor-web/e2e/editor-session-preview.spec.ts`, 4 теста. После фикса
`EDITOR_PREVIEW_WORKTREES_ROOTS`:

- ✅ `opens a session worktree and prepares player preview with contentSourceId` (setup/API)
- ✅ `serves changed Antarctica session plugin bundle to preview` (bundle/API)
- ❌ `supports Inspect selection and context menu for Antarctica fallback preview` (интерактив)
- ❌ `rolls back preview runtime state without dirtying authoring JSON` (интерактив)

Оба падения — **таймаут** (не assert-fail): напр. `frame.getByRole("button",{name:"Choose
path"}).click()` → ожидание заголовка `Result`, который **не появляется даже за 300с**.
Editor-toolbar в снимке рендерится (кнопки Play/Inspect есть), т.е. editor-shell жив.

**Механизм (см. §4-подробно ниже):** оба теста гоняют **полный интерактивный
playthrough внутри preview-iframe**. Editor встраивает `player-web` в iframe и грузит его
на контенте сессии (git-worktree, `contentSourceId`). В этой конфигурации одновременно
работают: **editor-prod** (shell) + **runtime-dev** (tsx) + **player-dev в iframe** (Next
dev, компилирует маршруты по требованию) + **chromium**, рендерящий ДВА вложенных
приложения. На 4 ядрах интерактивный цикл «клик → runtime POST → перекомпиляция/
ре-рендер маршрута плеера в iframe → следующий клик» starve-ится настолько, что раунд-трип
не завершается в отведённое время.

**Почему это среда, а не регрессия кода:**
- **standalone `player-web` e2e проходит 4/4**, включая полный Antarctica-playthrough
  (тот же код плеера, тот же runtime) — но БЕЗ вложенного iframe и БЕЗ параллельного
  editor. Разница только в нагрузке/вложенности.
- 2 **не**-интерактивных editor-теста (setup + bundle) проходят → сам preview-pipeline,
  worktree, компиляция манифеста и раздача плагин-бандла работают.
- Падают ровно 2 **самых тяжёлых интерактивных** теста → это профиль CPU-starvation, а не
  сломанной фичи (при сломанной фиче клик не срабатывал бы вовсе, а не висел по таймауту).

Не удалось снять даже подъёмом таймаута до 300с → это не «просто медленно», а
**залипание интерактивного раунд-трипа в preview-iframe под starvation**. Достоверно
воспроизвести/починить можно только на менее нагруженной машине (≥8 ядер), где
player-web в iframe успевает компилировать/отвечать.

## 5. Прочие baseline-блокеры (не регрессии)

- **`verify:legacy` красный (30 baseline stub-маркеров)** в НЕтронутых файлах
  (`services/runtime-api/.../agentRuntime*.ts`, `packages/contracts/ai/src/index.ts`,
  `apps/editor-web/.../agent-assistant-registry.test.ts`, mock-маркеры в
  `runtime-api.integration.ts`). Проверка `validate-legacy` по дизайну падает на них.
  Это pre-existing состояние (доска NEXT_STEPS: «runtime-api и player-web не имеют
  полностью зелёных проверок»). Ни один из моих коммитов не добавил новых маркеров
  (единственный внесённый в P0 — `health.ts` «not a stub» — исправлен).
- **Устаревшая player-e2e проверка (исправлена):** клик «Подсказка» ждал POST
  `/api/runtime/actions`, но hint стал UI-only панелью в `TSK-20260615` (команда
  `showPanel`, без серверного обработчика). Был pre-existing false-red — переписан на
  проверку клиентского рендера панели.

## 6. Единственная незакрытая задача: EditorWorkspace Phase 4

`TSK-20260630-editor-engine-modularization` **Phase 4** — декомпозиция ~2500-строчного
`apps/editor-web/src/components/editor-workspace.tsx` (63 `useState`, 20 `useEffect`) на
`useReducer`/хуки + дочерние панели. Её acceptance включает `npm run test:e2e` и «сохранить
e2e-поведение», а именно **интерактивные** editor-preview тесты — те самые 2, что не
поднимаются на этом боксе (§3–4). Декомпозиция крупного интерактивного React-компонента
без работающего interactive-regression gate несёт риск незаметных effect/re-render
регрессий, поэтому **сознательно не форсировалась** здесь.

**Как доделать:** на машине ≥8 ядер поднять editor e2e (см. §2), убедиться, что 4/4
зелёные на baseline, затем выполнить декомпозицию с gate = typecheck + 105 unit-тестов
editor-web + build + editor e2e 4/4. Non-goals и план — в самой задаче (Phases 1-4).

## 7. Обход блокера: prod-режим e2e и итог диагностики

Добавлено 2026-07-05 (TSK-20260704, срез A). Блокер обойдён **без изменения
продуктового кода** — только тестовая инфраструктура и устаревшие ожидания спека.

### Что сделано

1. **`npm run test:e2e:prod`** (`scripts/dev/run-e2e-prod.mjs`): последовательно
   собирает `player-web` и `editor-web` (`next build` по одному — параллельные
   сборки на 4 ядрах ловят SIGTERM), затем запускает playwright с
   `E2E_SERVER_MODE=prod` — webServer-команды переключаются на `next start`.
   Во время тестов компиляции нет вообще, интерактивный раунд-трип стоит
   только рендер + HTTP. ВАЖНО: `player-web` запекает `RUNTIME_API_URL` в
   rewrites на этапе build — скрипт передаёт правильный URL сам.
2. **`E2E_LOW_RESOURCE=1`** (включён в prod-скрипте по умолчанию): отключает
   запись trace/video/screenshot — playwright пишет их во время КАЖДОГО прогона
   (retain-on-failure решает только судьбу записи), на 4 ядрах это заметный налог.
3. Итог: **полный e2e-набор 8/8 за ~55 секунд на этом самом хосте** (editor 4/4,
   player 4/4).

### Настоящая причина падения 2 интерактивных тестов

После снятия компиляции из горячего цикла оба «environmental» падения оказались
воспроизводимыми и диагностируемыми дефектами **спека**, накопившимися за время,
пока editor e2e нельзя было запускать:

1. **Inspect/Antarctica**: спек ждал fallback-указатель
   `/content/data/infos/0/title`, но после нормализации UI-экранов Antarctica
   превью рендерится через `ui.manifest` экран `info-topbar`, и указатели стали
   экранными (`/screens/info-topbar/root/...`). Экран при этом рендерился
   полностью и корректно. Спек переведён на выбор по стабильной метке
   `data-preview-label="info-title"` и активный файл `ui/web.authoring.json`
   (маппинг выделения попадает в активный документ: `/root/screens/...`).
2. **Rollback/simple-choice**: спек ждал кнопку `"Choose path"`, которой больше
   нет — карточка рендерится с именем `"Choose the option with the visible
   tradeoff."` (player-спек был обновлён ранее, editor-спек отстал). Плюс
   открытая панель «Authoring JSON editor» плавает над предпросмотром и
   перехватывала клики в iframe — playwright молча ретраил клик до таймаута,
   что и выглядело как «залипание». Спек сворачивает панель перед кликами.

### Следствия

- «Нужна машина ≥8 ядер» — **снято**: интерактивный editor e2e работает здесь.
- `EditorWorkspace` Phase 4 (§6) разблокирован: gate `editor e2e 4/4` доступен
  через `npm run test:e2e:prod`.
- Dev-режим по-прежнему НЕ работает для editor-web на этом хосте (§3 в силе);
  для ручной разработки editor использовать production-режим или сильную машину.
