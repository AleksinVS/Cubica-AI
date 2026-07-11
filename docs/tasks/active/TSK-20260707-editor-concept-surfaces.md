# TSK-20260707-editor-concept-surfaces: Канальный просмотрщик и завершение viewport-пресетов

## Оглавление

- [Status](#status)
- [Understanding](#understanding)
- [Architecture Source](#architecture-source)
- [Scope](#scope)
- [Non-Goals](#non-goals)
- [Execution Plan](#execution-plan)
- [Acceptance](#acceptance)
- [Handoff Log](#handoff-log)

## Status

planned

Status note: задача выделена из завершенной Phase 9, §9.7–9.8, 2026-07-04.

## Understanding

UX-документ ADR-057 §9.8 фиксирует две оставшиеся «концептуальные» поверхности редактора,
которые сам документ помечает как «по готовности» и явно разрешает выделить в
отдельный под-TSK (design-spec Phase 9 п.3). Основная программа TSK-20260704
(Phases 0–9 core, Phase 10 closeout) реализована; здесь остаётся именно этот
концептуальный хвост, не блокирующий приёмку основной задачи. История версий
автора 2026-07-10 выделена в самостоятельную задачу
`TSK-20260710-editor-author-version-history`.

## Architecture Source

- `docs/architecture/adrs/057-preview-first-editor-ux-architecture.md` §8 (отложенные направления)
- `docs/architecture/editor-preview-first-ux.md` §9.8 (предпросмотр не-Web каналов и размеров экрана)
- `docs/tasks/artifacts/TSK-20260704-editor-preview-first-ux-implementation/design-spec.md` §3 (Phase 9 п.3)

## Scope

1. **Канальный просмотрщик Telegram** (§9.8): облегчённый отрисовщик
   Telegram-проекции (framework-neutral projections уже в `packages/contracts/ai`)
   как ленты сообщений/inline-клавиатур с пометкой «структурный просмотр, не
   эмуляция клиента»; реализует renderer adapter contract ADR-036 (второй адаптер,
   первое практическое подтверждение renderer-agnostic границы; сюда же
   подключается `previewRendererAdapterRef` для реальных регион-снимков из
   TSK-20260704 Phase 9.1); диагностика «нет вида для Telegram» ведёт в этот режим.
2. **Завершение viewport-пресетов** (§9.8): телефон/планшет/десктоп уже
   реализованы; остаются ориентация и связанные проверки выбора/подсветки.

## Non-Goals

- Реальное устройство/эмулятор Telegram, Phaser-адаптер (открытый вопрос ADR-036).
- Совместное редактирование, публикация в каталог (отдельные ADR/направления).

## Execution Plan

1. Канальный просмотрщик Telegram как второй renderer adapter (подтверждает
   renderer-agnostic границу; включает региональные снимки Phase 9.1).
2. Ориентация и завершение viewport-пресетов Web.

## Acceptance

- Telegram-просмотрщик рендерит Telegram-проекцию, выделение/hit-test работают тем
  же циклом, панель сущности и правки — как у Web; диагностика «нет вида для
  Telegram» ведёт в режим.
- Viewport-пресеты переключают размер и ориентацию Web-предпросмотра без изменения контента.
- Проверки зелёные; e2e не регрессирует.

## Handoff Log

- 2026-07-07: задача выделена из TSK-20260704 Phase 9 (§9.7–9.8) при closeout
  основной программы; основная задача (Phases 0–9 core + 10) реализована,
  концептуальный хвост вынесен сюда по явному разрешению design-spec.
- 2026-07-10: история версий автора выделена в самостоятельный корневой
  `TSK-20260710-editor-author-version-history`; здесь остаются Telegram-просмотр
  и завершение уже частично реализованных viewport-пресетов.
