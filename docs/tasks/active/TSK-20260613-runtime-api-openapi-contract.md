# TSK-20260613-runtime-api-openapi-contract: Runtime API OpenAPI Contract

## Оглавление

- [Status](#status)
- [Understanding](#understanding)
- [Why](#why)
- [Architecture Source](#architecture-source)
- [Scope](#scope)
- [Non-Goals](#non-goals)
- [Execution Plan](#execution-plan)
- [Acceptance](#acceptance)
- [Validation](#validation)
- [Artifacts](#artifacts)
- [Handoff Log](#handoff-log)

## Status

implemented-baseline

## Understanding

Задача понята так: API First остается целевым принципом Cubica, а текущий
backend остается модульным монолитом до подтвержденного выделения сервисов.
Нужно применить API First к фактическому `services/runtime-api`, не создавая
ложного впечатления, что Router, Game Engine and Game Repository уже являются
отдельными production-сервисами.

## Why

Сейчас `runtime-api` уже имеет внешний HTTP API, но current OpenAPI coverage
описывает в основном исторические или будущие service boundaries. Это создает
разрыв:

- клиенты зависят от endpoint'ов `runtime-api`;
- API First заявлен в `PROJECT_OVERVIEW.md`;
- CI не проверяет, что фактические endpoints покрыты current OpenAPI;
- будущая service extraction не имеет надежной compatibility baseline.

## Architecture Source

- `docs/architecture/adrs/051-api-first-contract-for-modular-monolith.md`
- `docs/architecture/adrs/017-modular-monolith-transition-and-service-extraction.md`
- `docs/architecture/adrs/019-runtime-api-owns-content-loading-and-player-facing-content-api.md`
- `docs/architecture/adrs/025-json-schema-as-ssot-for-manifest-validation.md`
- `docs/architecture/adrs/038-testing-architecture-and-policy.md`

If implementation needs a new architecture rule beyond ADR-051, update or add
an ADR before changing API governance.

## Scope

In scope:

- inventory all current public HTTP endpoints in
  `services/runtime-api/src/modules/player-api/httpServer.ts`;
- create `docs/architecture/runtime-api-openapi.yaml` using OpenAPI 3.1;
- define request/response schemas for current runtime-api endpoints;
- tag operations by logical module and future extraction boundary;
- label editor-preview/local/admin endpoints explicitly;
- add fixtures or contract tests for representative requests and responses;
- add CI validation for OpenAPI syntax and endpoint drift;
- label old Router/Engine/Repository OpenAPI files as target/future references,
  not current runtime-api coverage;
- update project docs and handoff logs.

Out of scope for this task:

- physically splitting `runtime-api` into Router, Engine or Repository services;
- generating server handlers from OpenAPI;
- replacing JSON Schema manifest validation with OpenAPI schemas;
- changing public endpoint semantics unless the contract inventory reveals an
  existing bug that must be fixed separately.

## Non-Goals

- Do not create fake endpoints for future services.
- Do not duplicate manifest schema rules manually inside OpenAPI.
- Do not use TypeScript-only types as the only source of API truth.
- Do not add game-specific API paths for `Antarctica` or any other concrete
  game.
- Do not make ADR files execution trackers; this TSK owns execution status.

## Execution Plan

### Phase 1. Endpoint And DTO Inventory

1. List every route handled by `httpServer.ts`.
2. Classify each route as:
   - current public player/runtime API;
   - admin/health API;
   - editor-preview/local API;
   - static plugin bundle delivery API.
3. Map request parsers from `requestValidation.ts` to contract schemas.
4. Map responses to existing contracts where possible:
   - player-facing content;
   - session snapshots;
   - action dispatch response;
   - Agent Turn request/response;
   - readiness responses.
5. Record any unstable or preview-only shape as explicit contract notes.

### Phase 2. Runtime API OpenAPI Baseline

1. Add `docs/architecture/runtime-api-openapi.yaml`.
2. Use OpenAPI 3.1.
3. Add `tags` matching ADR-051:
   - `Admin`;
   - `Content`;
   - `PlayerContent`;
   - `Sessions`;
   - `RuntimeActions`;
   - `AgentRuntime`;
   - `EditorPreview`.
4. Add `operationId` for every current endpoint.
5. Put shared schemas in `components.schemas`.
6. Use reusable responses for common errors.
7. Add `externalDocs` links to ADR-051 and relevant contracts.

### Phase 3. Historical Specs Classification

1. Add header notes to:
   - `docs/architecture/router-openapi.yaml`;
   - `docs/architecture/engine-api.yaml`;
   - `docs/architecture/repository-openapi.yaml`.
2. State that these files are future extraction references until their service
   exists as a deployable boundary.
3. Ensure `PROJECT_ARCHITECTURE.md` points to
   `runtime-api-openapi.yaml` for current API coverage.

### Phase 4. CI And Drift Checks

1. Add an OpenAPI syntax validation command.
2. Add an endpoint inventory check that compares known runtime-api routes with
   the OpenAPI `paths`.
3. Add representative request/response fixture validation.
4. Wire the checks into canonical verification or a named API contract command.
5. Document any temporary exceptions in `docs/legacy/debt-log.csv`.

### Phase 5. Contract Tests And Documentation

1. Add or update runtime-api integration tests to validate representative
   responses against the OpenAPI schemas.
2. Update `PROJECT_OVERVIEW.md` and `PROJECT_ARCHITECTURE.md` if the final
   contract names or paths differ from this plan.
3. Record final command output and remaining risks in this task.

## Acceptance

- `docs/architecture/runtime-api-openapi.yaml` exists and describes every
  current supported `runtime-api` HTTP endpoint.
- Historical Router/Engine/Repository OpenAPI files are labeled as target or
  extraction references, not current implementation coverage.
- OpenAPI validation is available through an npm script or CI script.
- Endpoint drift between `httpServer.ts` and OpenAPI is checked.
- Representative request and response fixtures are validated.
- Manifest structures remain governed by JSON Schema per ADR-025.
- No physical service split is required for acceptance.
- `npm run verify:canonical` passes, or unrelated failures are documented with
  exact command output.

## Validation

Planned validation commands:

```text
npm run verify:api-contracts
npm run verify:runtime-api
npm run verify:canonical
git diff --check
```

If `verify:api-contracts` does not exist yet, this task must create it or
document the exact replacement command before closeout.

Latest validation on 2026-06-13:

- `node --check scripts/ci/validate-runtime-api-openapi.js` - passed.
- `node scripts/ci/validate-runtime-api-openapi.js` - passed:
  `validate-runtime-api-openapi: OK`.
- `npm run verify:api-contracts` - passed:
  `validate-runtime-api-openapi: OK`.
- `git diff --check` - passed.
- `npm run verify:canonical` - blocked before the new API contract gate by
  existing `verify:legacy` findings: unregistered `not implemented` marker in
  `apps/editor-web/src/lib/agent-assistant-registry.test.ts:38` and
  unregistered `mock` markers in `services/runtime-api/tests/runtime-api.integration.ts`,
  `services/runtime-api/src/modules/ai/agentRuntime.ts`,
  `services/runtime-api/src/modules/ai/agentRuntimeReadiness.ts` and
  `packages/contracts/ai/src/index.ts`.

## Artifacts

- `docs/architecture/runtime-api-openapi.yaml`
- `docs/architecture/adrs/051-api-first-contract-for-modular-monolith.md`

## Handoff Log

### 2026-06-13 - Codex

- Created the execution package for applying API First to the current modular
  monolith.
- Bound the work to ADR-051: current `runtime-api` gets the implemented
  OpenAPI contract, while old Router/Engine/Repository specs remain future
  extraction references.

### 2026-06-13 - Codex implementation

- Added `docs/architecture/runtime-api-openapi.yaml` as the current OpenAPI
  3.1 contract for the implemented `services/runtime-api` modular monolith.
- Added `scripts/ci/validate-runtime-api-openapi.js` and
  `npm run verify:api-contracts` for contract shape, endpoint drift and
  future-extraction spec classification checks.
- Wired `verify:api-contracts` into `verify:canonical`.
- Marked historical Router, Game Engine and Game Repository OpenAPI files as
  `future-extraction-reference`, not current implementation coverage.
- Updated structure descriptions and regenerated `PROJECT_STRUCTURE.yaml`.
