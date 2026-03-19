# ADR-018: Source of Truth для логики игры находится в JSON-манифесте

- **Дата**: 2026-03-19
- **Статус**: Proposed
- **Авторы**: проектная команда Cubica / agent-architect
- **Компоненты**: `games/*`, `services/runtime-api`, `packages/contracts/*`, content pipeline, runtime architecture

## Контекст

В проекте одновременно существуют несколько типов артефактов, описывающих игру `Antarctica`:

- `games/antarctica/` содержит текущую рабочую заготовку игры и должен стать каноническим content layer;
- `games/antarctica/design/mockups/` содержит актуальные мокапы экранов и является источником UI-намерения;
- `draft/Antarctica/README.md` описывает структуру и поведение старого HTML-прототипа;
- `draft/Antarctica/scenario.md` и связанные draft-артефакты содержат историческое описание логики, шагов и механик;
- `games/antarctica/scenario.md` содержит сценарный текст, полезный для авторинга, обсуждения и AI-пайплайнов.

Ранее в архитектурных обсуждениях допускалась модель, при которой source of truth для логики игры может находиться в markdown-сценарии, а затем интерпретироваться или переноситься в исполнимую форму. Для AI-first и Code-first подхода это создаёт проблему:

- логика оказывается за пределами исполнимых контрактов;
- возникает разрыв между narrative-описанием и runtime-поведением;
- агентам и разработчикам приходится выводить структуру игры из prose-документов, а не из машиночитаемого артефакта;
- schema validation и deterministic runtime упираются в неформализованный источник данных.

## Решение

Принять следующие правила:

1. **Канонический source of truth для логики игры находится в JSON-манифесте**, расположенном в `games/<game-id>/game.manifest.json`.
2. **Markdown-сценарии не являются source of truth для исполнимой логики.**
   - `games/<game-id>/scenario.md` и draft-сценарии используются как narrative/source material, authoring input, review artifact или AI input;
   - они могут помогать заполнять манифест, но не заменяют его.
3. **`draft/Antarctica/README.md` является описанием legacy-прототипа, а не канонической структурой новой архитектуры.**
   - Его используют как reference для извлечения механик, сущностей и flow;
   - новая структура runtime, contracts и player не должна копировать устройство legacy HTML-прототипа.
4. **`games/antarctica/design/mockups/` является source of truth для UI mockups**, но не для runtime-логики.
5. **Любая исполнимая игровая логика должна появляться в манифесте или в связанных с ним машиночитаемых контрактах/runtime capabilities.**
6. **Вопрос о том, как именно заполняется JSON-манифест, не фиксируется этим ADR.**
   - это может быть ручное редактирование, tooling, генерация, AI-assisted authoring, импорт из draft-источников или иная pipeline-модель;
   - но на выходе source of truth обязан быть JSON-манифест.

## Последствия

Положительные эффекты:

- логика игры становится доступной для schema validation, тестов и deterministic runtime;
- AI-first архитектура получает машиночитаемый контекст вместо prose как первичного источника;
- code-first подход закрепляется на уровне content layer, а не только backend-кода;
- упрощается дальнейшее развитие `packages/contracts/manifest` и capability-based runtime.

Ограничения и trade-offs:

- потребуется явно извлечь логику `Antarctica` из draft-источников и нормализовать её в манифест;
- narrative markdown остаётся важным, но теряет статус первичного логического артефакта;
- для сложных игр может понадобиться richer manifest model и tooling, чтобы JSON оставался поддерживаемым.

## План внедрения

1. Обновить план миграции и agent-facing документы под новую truth model.
2. Зафиксировать роли артефактов `games/antarctica/`, `games/antarctica/design/mockups/`, `draft/Antarctica/README.md`, `games/antarctica/scenario.md`.
3. Развить `packages/contracts/manifest` и manifest validation под реальную модель `Antarctica`.
4. Извлечь игровую логику из draft-источников в `games/antarctica/game.manifest.json`.
5. Подключить runtime и player к манифесту как к единому исполнимому source of truth.

## Связанные артефакты

- `games/antarctica/game.manifest.json`
- `games/antarctica/scenario.md`
- `games/antarctica/design/mockups/`
- `draft/Antarctica/README.md`
- `draft/Antarctica/scenario.md`
- `docs/architecture/adrs/017-modular-monolith-transition-and-service-extraction.md`
