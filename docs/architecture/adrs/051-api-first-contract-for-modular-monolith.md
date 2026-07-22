# ADR-051: API First Contract For Modular Monolith

- **Дата**: 2026-06-13
- **Статус**: Accepted
- **Авторы**: Codex
- **Компоненты**: `services/runtime-api`, `apps/player-web`, `apps/editor-web`, `packages/contracts/*`, OpenAPI contracts, CI, future Router/Game Engine/Game Repository services
- **Связанные решения**: ADR-017, ADR-019, ADR-025, ADR-031, ADR-038, ADR-040, ADR-046

## Оглавление

- [1. Понимание решения](#1-понимание-решения)
- [2. Контекст](#2-контекст)
- [3. Термины](#3-термины)
- [4. Принятое решение](#4-принятое-решение)
- [5. Контракт текущего монолита](#5-контракт-текущего-монолита)
- [6. Границы будущего выделения сервисов](#6-границы-будущего-выделения-сервисов)
- [7. Правила изменения API](#7-правила-изменения-api)
- [8. Валидация и CI](#8-валидация-и-ci)
- [9. Архитектурные инварианты](#9-архитектурные-инварианты)
- [10. Отклоненные альтернативы](#10-отклоненные-альтернативы)
- [11. Последствия](#11-последствия)
- [12. Связанные артефакты](#12-связанные-артефакты)

## 1. Понимание решения

Решение понято так: Cubica сохраняет целевую распределенную модель сервисов,
но текущий рабочий backend остается модульным монолитом по ADR-017. Принцип
API First нужно применять уже сейчас, не дожидаясь физического выделения
Router, Game Engine или Game Repository.

Это означает: внешний HTTP API текущего `services/runtime-api` должен получить
собственный OpenAPI-контракт, проверяемый через CI. Будущие сервисные границы
отражаются в этом контракте через теги, компоненты и стабильные DTO, но не
притворяются уже существующими отдельными сервисами.

## 2. Контекст

`PROJECT_OVERVIEW.md` уже фиксирует API First как архитектурный принцип.
Исторические OpenAPI-файлы описывают будущие или ранние сервисные контуры:

- `docs/architecture/router-openapi.yaml`;
- `docs/architecture/engine-api.yaml`;
- `docs/architecture/repository-openapi.yaml`.

Фактическая current runtime boundary находится в `services/runtime-api`.
Он уже обслуживает health/readiness, player content, session creation,
action dispatch, Agent Turn and editor preview content reload. Если API First
ждать до service extraction, проект продолжит накапливать ручные HTTP
endpoint'ы без единого внешнего контракта.

OpenAPI Specification 3.1 подходит для текущего этапа: OpenAPI-документ
описывает API через `paths`, `components`, `tags`, `servers` и схемы данных,
и не требует, чтобы API был реализован физически распределенными сервисами.

## 3. Термины

- **API First** - подход, при котором внешний контракт API меняется и
  проверяется до или вместе с реализацией endpoint'а, а не восстанавливается
  из кода задним числом.
- **OpenAPI** - машинно-читаемая спецификация HTTP API: список путей,
  операций, параметров, тел запросов, ответов, ошибок и переиспользуемых схем.
- **Модульный монолит** - один разворачиваемый backend-процесс с внутренними
  модулями и строгими границами между ними.
- **Service extraction** - последующее выделение внутреннего модуля в отдельный
  сервис после появления устойчивого контракта, отдельного профиля нагрузки или
  эксплуатационного требования.
- **DTO** - Data Transfer Object, объект передачи данных между слоями или
  сервисами.

## 4. Принятое решение

Cubica принимает API First for modular monolith:

1. Текущий `runtime-api` получает канонический OpenAPI-контракт:
   `docs/architecture/runtime-api-openapi.yaml`.
2. Этот контракт описывает только реально поддержанные внешние HTTP endpoints
   текущего монолита.
3. Будущие сервисные границы отражаются через `tags`, `operationId`,
   reusable `components` and naming, but not through fake servers or paths.
4. Исторические `router-openapi.yaml`, `engine-api.yaml` and
   `repository-openapi.yaml` остаются target/extraction references until the
   corresponding service exists or the path is formally archived.
5. JSON Schema remains source of truth for manifest structures by ADR-025.
   OpenAPI may reference or mirror transport DTO schemas, but must not become a
   second manifest schema source.
6. Any implemented HTTP endpoint that is part of the supported external API
   must be covered by OpenAPI and contract validation.

## 5. Контракт текущего монолита

`docs/architecture/runtime-api-openapi.yaml` must start as the current external
contract for:

- `GET /health`;
- `GET /readiness`;
- `POST /content/reload`;
- `GET /content-sources/{contentSourceId}/plugin-bundles/{pluginId}/{contentHash}.mjs`;
- `GET /published-plugin-bundles/{gameId}/{pluginId}/{contentHash}.mjs`;
- `GET /games/{gameId}/player-content`;
- `GET /games/{gameId}/readiness`;
- `POST /sessions`;
- `GET /sessions/{sessionId}`;
- `POST /sessions/{sessionId}/preview-restore`;
- `POST /actions`;
- `POST /agent-turns`.

The first contract may intentionally mark local/editor-only preview endpoints
as preview/admin scoped. They still need a contract because they are public
HTTP behavior inside local/editor flows.

Recommended tags:

- `Admin`;
- `Content`;
- `PlayerContent`;
- `Sessions`;
- `RuntimeActions`;
- `AgentRuntime`;
- `EditorPreview`.

These tags express logical boundaries for later extraction without forcing
immediate service deployment.

## 6. Границы будущего выделения сервисов

When Cubica extracts services later:

1. The existing `runtime-api` OpenAPI contract is the compatibility baseline.
2. A gateway or Router service may continue to expose the same public paths
   while internally calling extracted services.
3. An extracted service may receive its own OpenAPI file only after its
   boundary is real in code and deployment.
4. Shared `components.schemas` should be moved to shared contract packages or
   referenced from generated schema artifacts, not copied manually between
   service specs.
5. Breaking public API changes require versioning or a documented migration
   window, not silent endpoint replacement.

## 7. Правила изменения API

For every new or changed current HTTP endpoint:

1. Update `runtime-api-openapi.yaml` in the same change.
2. Update or add request/response fixtures for contract tests.
3. Update TypeScript contracts only as implementation bindings, not as the
   only source of external API truth.
4. Validate request payloads and responses against schemas where practical.
5. Keep `operationId` stable unless the operation is intentionally replaced.
6. Mark local/editor-only or admin-only endpoints explicitly.
7. Do not add game-specific endpoint branches for one concrete game.

## 8. Валидация и CI

CI must enforce:

- OpenAPI syntax validation;
- drift between supported external endpoints and `runtime-api-openapi.yaml`;
- schema validation for representative request/response fixtures;
- contract tests for player-facing content, session creation, action dispatch
  and Agent Turn;
- an explicit rule that historical service specs are not treated as current
  runtime-api coverage.

This extends ADR-038 testing policy and does not replace existing runtime,
player or manifest validation.

## 9. Архитектурные инварианты

- API First applies to the modular monolith now.
- The target distributed service model remains valid.
- OpenAPI describes external HTTP contracts, not internal function calls.
- The current monolith must not expose fake future service endpoints just to
  match old diagrams.
- JSON Schema remains the source of truth for manifests; OpenAPI must not fork
  manifest validation.
- Future service extraction must preserve or intentionally version the public
  API contract.
- Editor preview endpoints must be labeled as preview/local/admin scoped.
- API docs and implementation must not drift silently.

## 10. Отклоненные альтернативы

### A. Wait For Distributed Services Before API First

Rejected. This leaves the current public `runtime-api` surface undocumented and
unverified while real clients already depend on it.

### B. Treat Old Router/Engine/Repository Specs As Current API Coverage

Rejected. Those specs describe target or historical boundaries, not the current
implemented HTTP surface.

### C. Generate The Runtime Server From OpenAPI Immediately

Rejected for the first slice. Generated server code could be useful later, but
it is not required to make API First effective. The immediate risk is contract
drift, not handler boilerplate.

### D. Keep OpenAPI As Human Documentation Only

Rejected. A non-validated OpenAPI file becomes stale quickly and does not
enforce the API First principle.

## 11. Последствия

Positive consequences:

- current monolith gets a real external API contract;
- future service extraction has a compatibility baseline;
- clients and SDKs can generate or validate against one implemented contract;
- CI can catch undocumented endpoint drift;
- historical service specs stop masking missing current coverage.

Costs and risks:

- runtime-api request/response shapes must be inventoried;
- some current DTOs may need cleaner names or stable contract homes;
- CI needs OpenAPI validation tooling;
- old target service specs need labels so developers do not mistake them for
  implemented contracts.

## 12. Связанные артефакты

- `docs/architecture/PROJECT_ARCHITECTURE.md` - canonical architecture summary.
- `PROJECT_OVERVIEW.md` - high-level project architecture overview.
- `docs/architecture/router-openapi.yaml` - future Router reference.
- `docs/architecture/engine-api.yaml` - future Game Engine reference.
- `docs/architecture/repository-openapi.yaml` - future Game Repository
  reference.
