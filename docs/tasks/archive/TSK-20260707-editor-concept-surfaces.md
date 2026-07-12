# TSK-20260707-editor-concept-surfaces: Канальный просмотрщик и viewport-пресеты

## Оглавление

- [Status](#status)
- [Parent](#parent)
- [Understanding](#understanding)
- [Architecture Source](#architecture-source)
- [Current Baseline](#current-baseline)
- [Scope Classification](#scope-classification)
- [Scope](#scope)
- [Non-Goals](#non-goals)
- [Plan Approval](#plan-approval)
- [Execution Plan](#execution-plan)
- [Acceptance](#acceptance)
- [Validation](#validation)
- [Artifacts](#artifacts)
- [Risks and Controls](#risks-and-controls)
- [Plan Amendments](#plan-amendments)
- [Handoff Log](#handoff-log)

## Status

completed

Status note: Web orientation и структурный Telegram viewer с единым renderer-
adapter selection loop реализованы и приняты production E2E 2026-07-12.

## Parent

none

История версий автора выделена в самостоятельную корневую задачу
`TSK-20260710-editor-author-version-history`.

## Understanding

Работа завершает две независимые поверхности редактора: адаптивный Web-
предпросмотр с ориентацией и структурный просмотр канального Telegram UI. Это
не реализация Telegram-бота и не эмуляция официального клиента.

Основной Telegram-просмотрщик обязан читать `ui/telegram.authoring.json` либо
его скомпилированную channel-specific UI projection. Контракт
`CubicaSurface → CubicaTelegramSurfaceProjection` из `packages/contracts/ai`
описывает только генеративные AI-поверхности и не заменяет UI-манифест обычной
deterministic игры. Для AI-driven игры он может быть отдельным режимом
просмотра поверхности агента.

## Architecture Source

- ADR-036 — renderer-neutral preview adapter boundary.
- ADR-045 — Cubica Surface не является источником обычного game/UI content.
- ADR-052/054 — channel view живёт в соответствующем UI authoring manifest и
  связывается с игровой сущностью через проекцию редактора.
- ADR-057 и `docs/architecture/editor-preview-first-ux.md` §9.8 — концепт
  канального просмотрщика и viewport-пресетов.
- `LEGACY-0035` — реальная доставка Telegram остаётся отдельным не закрытым
  архитектурным направлением.

## Current Baseline

Готово:

- Web preview работает в iframe через существующий preview adapter;
- есть размеры desktop/tablet/mobile;
- hit-test, выделение, панель сущности и optional region snapshot работают для
  Web;
- `Antarctica` содержит реальный `authoring/ui/telegram.authoring.json`.

После срезов 2026-07-11 готовы orientation, структурный Telegram viewer,
renderer-adapter bounds/point/rect hit-test/highlight и переход из
`entity-missing-view`. Не готов production E2E обоих новых режимов. Быстрый fix
для Telegram намеренно скрыт: текущий builder не умеет доказанно выбрать
schema-valid контейнер внутри `/root/screens`.

## Scope Classification

- **Общая возможность платформы:** viewport orientation и структурный adapter
  для channel-specific Telegram UI manifest.
- **Игровое содержимое:** только тестовая fixture; условия по `gameId`
  запрещены.
- **Отдельная AI-возможность:** проекция `CubicaSurface` в Telegram допустима
  только при явном входе agent surface и не используется как fallback обычного
  UI manifest.

## Scope

1. Добавить orientation state, переключатель и перестановку ширины/высоты для
   телефонного и планшетного Web preview без изменения URL или содержимого.
2. Добавить framework-neutral вход структурного Telegram adapter из
   channel-specific UI manifest: сообщения, подписи компонентов и
   inline-action buttons с source pointers.
3. Подключить viewer к существующему renderer adapter contract: bounds,
   hit-test, highlight и выбор сущности должны идти тем же циклом, что Web.
4. Показать явную плашку «структурный просмотр, не эмуляция клиента».
5. Диагностика отсутствующего Telegram view должна открывать Telegram channel
   и выбирать соответствующую сущность.

## Non-Goals

- Telegram Bot API, реальное устройство, сетевой bot adapter или доказательство
  production delivery;
- преобразование обычного UI manifest в `CubicaSurface`;
- Phaser adapter;
- публикация, совместное редактирование и изменение runtime contracts.

## Plan Approval

`not_required`

После исправления ошибочного источника Telegram план следует уже принятым
границам ADR-045/052/054. Новый публичный контракт, источник истины или
граница доверия не вводятся. Если для просмотра окажется нужен новый общий
runtime Telegram DTO, работа останавливается для отдельного решения PM.

## Execution Plan

### Этап 1. Web orientation

- [x] Добавить orientation state и понятные русские подписи.
- [x] Переставлять размеры mobile/tablet без изменения preview content.
- [x] Добавить component/state/CSS проверки и typecheck.

### Этап 2. Telegram UI fixture и чистая проекция

- [x] Добавить нейтральный Telegram authoring fixture.
- [x] Определить минимальную renderer-neutral projection из UI manifest без
  импортов Telegram SDK и без `CubicaSurface` для обычной игры.
- [x] Покрыть unknown component, action binding и source pointer tests.

### Этап 3. Пользовательская поверхность

- [x] Добавить channel switch и структурную ленту сообщений/кнопок.
- [x] Подключить selection, bounds, point/rect hit-test, highlight и EntityInspector.
- [x] Добавить переход из диагностики отсутствующего вида.

### Этап 4. Сквозная проверка и закрытие

- [x] Проверить Web orientations и Telegram viewer в production E2E.
- [x] Обновить архитектурную сводку и перенести TSK в архив.

## Acceptance

1. Телефон и планшет переключают portrait/landscape с корректной шириной и
   высотой; iframe URL и authoring content не меняются.
2. Telegram viewer читает Telegram UI manifest, а не AI Surface, и рендерит
   структурную ленту с явным предупреждением об ограничении.
3. Выделение/hit-test используют renderer adapter contract; панель сущности и
   правки работают через существующий `EditorChangeSet` flow.
4. AI-driven `CubicaSurface` projection не смешивается с обычным UI manifest.
5. Нет условий по идентификатору игры; общность доказана нейтральной fixture.
6. Тесты, typecheck, production build и editor E2E зелёные.

## Validation

```bash
npm test --workspace @cubica/editor-web -- --no-file-parallelism <focused viewport/telegram tests>
npm run typecheck --workspace @cubica/editor-web
skills/C_low-memory-host-operations/scripts/preflight.sh
RUNTIME_API_URL=http://127.0.0.1:3001 npm run build:web:sequential
npm run test:e2e:prod -- <editor concept surface specs>
```

## Artifacts

Нормативные результаты — код, тесты и этот TSK. Временные screenshots/traces
хранятся только в `.tmp/` и удаляются после проверки.

## Risks and Controls

| Риск | Контроль |
|---|---|
| UI manifest подменяется AI Surface | Раздельные входные типы и fixtures; обычный viewer не импортирует AI projection builder |
| Просмотр воспринимается как реальный Telegram | Постоянная плашка и явный non-goal production delivery |
| Неизвестный компонент исчезает | Структурный fallback с диагностикой и source pointer |
| Выделение расходится с Web | Один renderer adapter contract и общие selection tests |
| Ориентация меняет контент | Меняются только размеры контейнера; URL и документ остаются прежними |

## Plan Amendments

### 2026-07-11 — исправлен источник Telegram-проекции

Прежний план ошибочно ссылался на `packages/contracts/ai` как источник
обычного Telegram UI. Аудит подтвердил границу ADR-045/052/054: основной вход —
channel-specific UI manifest; AI Surface является отдельным специальным режимом.

## Handoff Log

- 2026-07-07: задача выделена из завершённой preview-first программы.
- 2026-07-10: история версий автора выделена в отдельную корневую задачу.
- 2026-07-11: план приведён к исполнимому шаблону; исправлено смешение UI
  manifest и AI Surface; независимый orientation-срез начат параллельно.
- 2026-07-11: Web orientation реализована в `apps/editor-web`: состояние
  landscape/portrait, доступный переключатель, размеры desktop/tablet/mobile,
  статусная строка и два focused tests. Проверки: 2/2 теста, editor-web
  typecheck, production build Next.js 15.1.6 и `git diff --check` успешно.
  Этап 1 завершён; этапы 2–4 остаются.
- 2026-07-11: Telegram structural viewer реализован из
  `entityProjectionDocuments[channel=telegram]`: чистая проекция сообщений,
  подсказок, кнопок и неизвестных компонентов, file/pointer metadata,
  постоянная плашка ограничения, Web/Telegram switch и selection в read-only
  EntityInspector через exact/parent pointer mapping. Focused checks: 4 файла,
  6 тестов; typecheck успешно. Этап 2 и первый пункт этапа 3 завершены.
  Полный renderer-adapter hit-test/bounds и переход/quick-fix из
  `entity-missing-view` остаются открытыми и не выдаются за готовые.
- 2026-07-11: renderer adapter завершён: Telegram DOM отдаёт локальные bounds,
  source-file/entity metadata, point/rect hit-test и highlight через общий
  `PreviewRendererAdapter`; Web descriptor regression сохранён. Проверка
  `entity-missing-view` несёт структурированные code/channel, переключает
  viewer и выбирает сущность без разбора текста. Небезопасный quick-fix для
  `/root/screens` скрыт, пока schema-aware target builder его не поддерживает.
  Проверки: 24/24 focused, расширенный набор 35/35, typecheck и diff-check.
- 2026-07-12: документационный аудит подтвердил `in_progress`: функциональный
  срез реализован, но production E2E на корневом контуре ещё не выполнен.
  Задача не переносится в архив до этой фактической проверки.
- 2026-07-12: итоговый production Playwright-run прошёл 5/5. Сценарий
  Antarctica на живом Web preview проверил tablet/portrait,
  mobile/landscape, переключение в Telegram с постоянной плашкой ограничения и
  возврат в Web; unit/typecheck/build evidence также зелёные. Этап 4 закрыт,
  задача перенесена в архив.
