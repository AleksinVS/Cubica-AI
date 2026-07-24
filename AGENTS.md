# AGENTS

This file defines global rules for AI agents working in this repository.

---

## Оглавление

- [1. Scope and precedence of `AGENTS.md`](#1-scope-and-precedence-of-agentsmd)
- [2. General rules for agents](#2-general-rules-for-agents)
- [2.1 Опциональный процесс `$cubica`](#21-опциональный-процесс-cubica)
- [2.2 ADR and `PROJECT_ARCHITECTURE.md` synchronization](#22-adr-and-project_architecturemd-synchronization)
- [3. Key project documents to read first](#3-key-project-documents-to-read-first)
- [4. Work with temporary files](#4-work-with-temporary-files)

---

## 1. Scope and precedence of `AGENTS.md`

- A **global**, short and stable `AGENTS.md` lives in the **repository root** (this file).
- Each subsystem/service **may** have its own local `AGENTS.md`.
- **Proximity rule:** always follow the **nearest** `AGENTS.md` (closest in the directory tree).
- **Conflict rule:** if global and local rules conflict, the **local `AGENTS.md` has priority**.

Agents must always load and follow the nearest `AGENTS.md` before working in that area of the codebase.

---


## 2. General rules for agents

Agents must always:
1. **When planning, configuring, and developing, use Context7 MCP to get up-to-date documentation and best practices.**
2. **After any full context compaction, reload the canonical process files**
   - Re-read the nearest `AGENTS.md`.
   - Re-read the project-local `skills/C_cubica/SKILL.md` when the current work uses the Cubica development workflow.
   - Read active project skills only from `skills/`; `.codex/skills/` is a Codex discovery bridge and must not contain independent copies.
   - Never apply or invoke `SKILL.md` files from `skill-candidates/`. That catalog contains inactive external snapshots for reference and future adaptation only.
   - Treat this reload as mandatory before continuing implementation, review, or planning after a compaction boundary.
3. **Maintain documentation**
   - Create and update documentation wherever it is needed;
   - Never leave documentation in a state that contradicts the actual code or structure.
   - For all documentation files that are more than a few sections long, add a **Table of Contents** at the top.
   - The Table of Contents should use **internal anchors/links** to sections within the same file.

4. **Write clear and rich comments in code**
   - Comment code so that a **complete newcomer to the project** can quickly understand what is happening by reading:
     - The file-level header comment (what this file/module is for).
     - Function/method/class docstrings.
     - Key inline comments for non-obvious logic and decisions.
   - Comments should explain **why** something is done, not only **what** is done.

5. **Rules for user interaction**
   - Unless the user explicitly says otherwise, treat the user as a **product manager (PM)** who:
     - manages the agents and owns product and architecture approvals;
     - understands the product goals and the project architecture at a high level;
     - is not expected to know the implementation stack, repository layout, code, or the numbers and contents of individual ADRs.
   - Make every response self-contained for that PM context:
     - never use an ADR number, file path, library name, code symbol, or internal project term as the sole explanation;
     - on first mention, briefly explain what the referenced decision or component does, why it exists, and why it matters to the current product decision;
     - use links and technical evidence as optional supporting detail, not as required reading for understanding the answer.
   - Lead with the product outcome, risk, or decision that matters to the user. Then provide the necessary architecture explanation, and only then the implementation details or evidence.
   - Clearly distinguish between:
     - an already accepted project decision;
     - a new architecture proposal that requires user approval;
     - an implementation detail that the agent may decide autonomously;
     - known technical debt or a temporary limitation.
   - When requesting an architecture decision, explain in plain language:
     - what must be decided;
     - why the decision is needed now;
     - the agent's recommended option and the reason for it;
     - realistic alternatives and their trade-offs;
     - what the approval enables, constrains, or postpones.
   - For large reviews and plans, start with a short conclusion and priorities, then provide enough structured detail that the user does not need to open the referenced code or architecture documents to understand the recommendation.
   - Prefer clear, standard terminology over slang or project-specific jargon.
   - If a term might not be obvious to a new developer, treat it as non-standard and explain it (see the next point).
   - When using a term that is not widely understood or is domain-specific (for example: “daemon”, “middleware”, “RPC gateway”, “filter graph”, or Russian terms like «демон», «промежуточное ПО», «шлюз RPC», «граф фильтров»):
     - On its **first appearance** in a file or document, provide a **short definition**:
       - In code: as an inline comment or part of the docstring.
       - In docs: as a parenthetical definition or a short glossary-style note.
   - After the first clear definition, you may use the term without repeating the explanation in that same file.
   - Write in a simple and understandable way, avoiding complex phrasing and unnecessary professional jargon.
   - When using a special or domain-specific term, give a short explanation or definition the first time it appears in the response, file, or document (this rule reinforces points 5–6 above).
   - Avoid Anglicisms whenever possible.

6. **Write ADR for any architecture changes**
   - When responding to or working on architectural decisions, proposals, or questions, the agent must always start its response by explicitly describing how it understood the decision/proposal/question.
   - All architectural solutions must be reflected in the ADR.
   - ADRs must contain only project architecture decisions, constraints, rejected alternatives, and consequences.
   - ADRs must not be used as execution plans, slice trackers, next-step lists, or card-by-card migration specs.
   - Delivery-specific bounded gameplay details must go in Gameplay Slice Records under `docs/architecture/gameplay-slices/`; task execution plans and handoffs go in `docs/tasks/active/`.

7. **Manage subagent lifecycle**
   - A subagent is a delegated worker process, thread, or external agent session started to perform a bounded part of the current task.
   - After a subagent finishes its work and its result has been collected, the parent agent MUST explicitly close or terminate that subagent if it is no longer needed.
   - Do not leave completed, failed, or obsolete subagent sessions running or open; this prevents dangling workers from blocking future agent spawns.
   - Before reporting that a subagent-driven task is complete, check that no unnecessary subagents remain active.

8. **Use subagents, plan efficient execution, and simplify final designs**
   - Там, где это оправдано, используй субагентов и распараллеливай работу.
   - Модель и reasoning (глубину рассуждения модели) выбирай исходя из сложности и критичности задачи.
     - Дешевая  модель (например `Luna` или `Haiku`) с reasoning `low`, `medium`, `high` — для механической работы и выполнения тестов. Разрабатывать тесты и исправлять выявленные ошибки должны более дорогие и "умные" модели или основной агент — в зависимости от сложности тестов и ошибок. Для выполнения тестов всегда используй субагента дешевого субагента, кроме двух случаев: когда сложность выполнения тестов оправдывает повышение до более дорогой модели; когда речь идет о единичных тестах, которые дешевле запустить без субагентов;
     - средняя по стоимости и уровню модель (например, `Terra`, `Sonnet`) с reasoning `medium` или `high` — для простых или очевидных задач;
     - самая дорогая и умная модель (например, `Sol`, `Opus`) с reasoning `high` — для сложных, неочевидных, критичных и архитектурно значимых задач.
   - Сравнительный визуальный анализ (систематическое сопоставление реализованного интерфейса с макетом, эталоном или снимком экрана) относится к наиболее сложным задачам: итоговый анализ должна выполнять наиболее сильная модель с reasoning `high`. Более дешевой модели можно поручить только механическую подготовку материалов и измерений, но не итоговую оценку расхождений, их причин и приоритетов исправления.
   - При подготовке исполнительской документации в `docs/tasks/` следуй подробным локальным правилам из `docs/tasks/AGENTS.md`: план должен допускать необязательное разбиение на проверяемые блоки для разных уровней моделей и глубины рассуждения.
   - На заключительном этапе планирования архитектуры или крупного исполнительского блока обязательно проверь, можно ли упростить архитектуру, реализацию или последовательность работ без потери требуемой функциональности, качества, безопасности и принятых ограничений. Зафиксируй принятые упрощения либо кратко объясни, почему дальнейшее упрощение нецелесообразно.
   - Такая проверка не разрешает самостоятельно менять согласованные архитектурные границы. Если упрощение затрагивает публичные контракты, источник истины, границы доверия и безопасности, хранение, совместимость или существенную стоимость эксплуатации, сначала согласуй решение с PM и отрази его в ADR.
   - Архитектурные решения принимает только основной агент после согласования с PM. Субагент может провести аудит, собрать варианты, оценить последствия или реализовать уже принятое решение, но не может самостоятельно утвердить новую архитектурную границу.
   - Передавай субагенту максимально полный уже собранный контекст: точную цель, принятые решения, найденные факты, пути к нужным файлам, ограничения, ожидаемые результаты и проверки. Не заставляй субагента повторять уже выполненную основным агентом подготовительную работу.
   - Основной агент обязан проверить результат субагента по исходным файлам, контрактам и свежим доказательствам перед принятием или передачей пользователю.

9. **Развивать платформу через конкретные игры**
   - По умолчанию новая продуктовая разработка начинается с вводных PM по конкретной игре и одного **вертикального среза** (законченного сценария от правил и состояния до интерфейса и проверок).
   - Агент готовит и реализует единый план игрового среза. В плане он обязан отделить готовые возможности платформы, недостающие общие возможности и содержимое, которое остается только в этой игре.
   - Архитектурные пробелы закрываются параллельно с игрой и в объеме, необходимом выбранному срезу. При этом механизм игрового движка проектируется как универсальная, комбинируемая возможность, если правило можно выразить через общие операции над состоянием, коллекциями, графами, событиями, временем или вычислениями. Ограничение объема среза запрещает реализовывать невостребованные функции «на будущее», но не оправдывает узкий предметный эффект в общем движке.
   - До реализации агент выносит PM только существенные архитектурные вопросы: изменение публичных контрактов, источника истины, границ доверия и безопасности, хранения, совместимости игр или существенной стоимости эксплуатации. Выбор библиотек, внутренняя декомпозиция и распределение работы между субагентами не требуют согласования.
   - Новая общая возможность доказывается сценарием выбранной игры и нейтральной тестовой фикстурой (минимальным набором тестовых данных без имен и правил этой игры).
   - Этот режим не включает `$cubica`. Навык `$cubica` применяется только по прямому указанию пользователя. Полное описание режима хранится в `docs/tasks/STRATEGY.md`.

10. **Manage architectural drift and legacy gaps**
    - A gap between the current state and the target architecture is allowed, but it MUST be intentional, planned, and strictly documented as tech debt or legacy.
    - Fixing such documented gaps has a high priority. Unplanned architectural drift is strictly prohibited.

11. **Platform purity over game-specific hacks**
    - Any new game mechanic MUST be expressed through the schema-first Game Intent → Cubica Mechanics IR path: typed state model, bounded action parameters, published plans, composable operations and authoring macros.
    - A new game rule MUST first be assembled from the existing operation catalog. A new general runtime operation or public schema extension is allowed only when the accepted language cannot express the rule with the required type safety, atomicity, determinism, security and bounded cost; this is an architecture change and requires PM approval.
    - NEVER add game-specific `if/else` branches or hardcode game IDs (e.g., "antarctica") in the core platform layers (like `services/runtime-api`).
    - Before designing or implementing a game mechanic, the agent MUST explicitly analyze whether the mechanic is:
      - **general**: useful for a whole class of games or the platform as a whole;
      - **game-specific**: meaningful only for one concrete game or scenario.
    - If the classification is unclear, the agent MUST clarify it with the user or document the assumption before implementation.
    - General mechanics belong in platform contracts, the neutral Mechanics operation catalog, schema extensions, reusable algorithms, or shared renderer behavior. Game-specific workflows belong in the concrete game's authoring macros, plans, bundle, plugin, and content; they must not leak into generic player/runtime layers.
    - Для игрового движка универсальность является целевым свойством, а не риском, который нужно откладывать до второго или третьего похожего случая. Один реальный игровой срез может быть достаточным основанием для общей возможности, если контракт использует нейтральные понятия, допускает композицию и доказан нейтральной тестовой фикстурой.
    - По возможности общие runtime-операции должны описывать выбор, фильтрацию, упорядочивание, вычисление, массовое изменение, планирование и атомарную композицию над игровыми данными. Они не должны кодировать предметную семантику вроде «открыть построенную дорогу», если то же правило выражается общими операциями над объектами и временем.
    - Запрет преждевременной универсальности относится к внутренним техническим абстракциям самой платформы, у которых нет текущего потребителя. Он не применяется к публичному декларативному языку игрового движка: узкие игровые операции там создают риск дорогой последующей миграции всех игр.

12. **Maintain PROJECT_STRUCTURE.yaml and .desc files**
    - `PROJECT_STRUCTURE.yaml` is the single machine-readable source of truth for the repository layout.
    - When adding new significant directories, you MUST create a `.desc.json` file inside them containing a short semantic description (1-2 sentences).
    - After any structural changes (adding/removing folders or `.desc.json` files), you MUST run `node scripts/dev/generate-structure.js` to regenerate `PROJECT_STRUCTURE.yaml` and keep the architecture context up to date.
    - `PROJECT_STRUCTURE.yaml` is a navigation map of the current repository, not an inventory of history: archived content (completed `TSK-*` files, historical snapshots, retired hierarchies) must never be listed file-by-file in it.
    - Archive directories (the repository-root `archive/`, `docs/tasks/archive/`, and any future archive) MUST declare `"_collapse": true` in their `.desc.json`; the generator then renders such a directory as a single `directory...` line without contents. Per-file descriptions inside an archive `.desc.json` remain allowed where governance checks require them (for example, task descriptions in `docs/tasks/archive/.desc.json`), but they are metadata only and are not published into `PROJECT_STRUCTURE.yaml`.

13. **ANTI-PATTERN: Declarative vs. Imperative Drift**
    - NEVER replace declarative, cross-platform contracts (e.g., JSON Schema, OpenAPI specs) with language-specific imperative code (e.g., manual TypeScript type guards, Zod schemas isolated in backend code).
    - JSON Schema is the Single Source of Truth (SSOT) for data structures like Game Manifests. Validation must be performed by executing a standard validator (like AJV) against the JSON Schema, not by writing manual `if (typeof x !== 'string')` checks.

14. **Scale verification to the size and risk of the change**
    - A commit by itself is not a reason to run the entire project test suite.
    - After an ordinary small or medium change, run only the focused tests for the changed behavior and the cheapest relevant static checks, such as type checking, schema validation, or `git diff --check`.
    - After a large implementation block that changes several subsystem boundaries, run an expanded cross-subsystem verification once the block is stable. Do not repeat the same expensive checks after every intermediate commit when the verified code has not changed.
    - Run the full canonical verification only at a stage boundary, before a release or final acceptance, after a high-risk change to shared contracts or infrastructure, when explicitly requested by the user, or when narrower evidence cannot establish safety.
    - If a later edit affects behavior that was already checked, rerun the narrowest check that directly covers that behavior. Reuse still-current evidence for unaffected areas.
    - In the handoff, state which checks were run, which were intentionally not run, and what residual risk remains.

15. **Complete agent branches through user-approved integration**
    - Work committed or pushed only to an agent/feature branch is not yet integrated into the project.
    - Before merging a completed branch into `main`, the agent MUST summarize the result and checks and obtain explicit user approval. A direct user instruction to merge the branch into `main` is sufficient approval and MUST NOT be requested again.
    - After approval, the agent MUST update remote refs, merge the completed branch into the latest `main`, resolve conflicts without dropping newer `main` work or approved branch changes, run verification proportional to the integrated change, and push `main` without rewriting history.
    - Do not perform integration in a dirty working tree that contains unrelated user or agent changes. Use a separate clean worktree and preserve the original tree unchanged.
    - Do not leave an approved completed branch unmerged unless the user explicitly asks to keep it separate or the repository's protected-branch workflow blocks direct integration; in that case, report the exact remaining merge action.

---

## 2.1 Опциональный процесс `$cubica`

При использовании проектного навыка `skills/C_cubica/SKILL.md` действуют правила ADR-068:

- только навык `$cubica` применяется по явному указанию пользователя; остальные навыки, включая перенесенные или адаптированные из `agent-skills` и `superpowers`, могут включаться автоматически по своим обычным правилам сопоставления запроса;
- человек утверждает общий план корневой `TSK-*` и архитектурные решения;
- явная команда реализовать ранее рассмотренный план считается его утверждением;
- оркестратор самостоятельно принимает неархитектурные решения, декомпозирует работу, назначает субагентов, организует проверки и выполняет итоговую приемку;
- самостоятельный результат может получить дочерний `TSK-*` с полем `Parent`, но нормативная глубина ограничена одним уровнем;
- повторное согласование требуется при изменении архитектуры, цели, границ, основных результатов, общей приемки или существенного необратимого риска;
- подтверждение прав, секретов и разрушительных внешних операций остается обязательной границей безопасности;
- при частичном блокере оркестратор продолжает независимые части утвержденного плана;
- временные задания и отчеты субагентов хранятся в `.tmp/agent-workflow/`, а не образуют параллельную систему планов.

## 2.2 ADR and `PROJECT_ARCHITECTURE.md` synchronization

When adding or changing any ADR, agents must update `docs/architecture/PROJECT_ARCHITECTURE.md` in the same change.

- The accepted, proposed, or draft decision from the ADR must be reflected in `PROJECT_ARCHITECTURE.md` with the minimum sufficient description: the essence of the decision, key constraints, invariants, and consequences needed to understand the platform architecture unambiguously.
- `PROJECT_ARCHITECTURE.md` must cover all current active and prospective ADRs. This includes `Accepted`, `Proposed`, and `Draft` ADRs that still describe a live or possible architecture direction.
- Agents must keep `PROJECT_ARCHITECTURE.md` current when ADR status, scope, constraints, or consequences change.
- For general architecture understanding, `PROJECT_ARCHITECTURE.md` should be enough. Read individual ADR files only when additional context, detailed alternatives, or deeper reasoning is needed.

## 3. Key project documents to read first

Before planning anything, use these entry points:

---

- [PROJECT_OVERVIEW.md](/home/abc/projects/Cubica-AI/PROJECT_OVERVIEW.md) - high-level product and platform context.
- [PROJECT_STRUCTURE.yaml](/home/abc/projects/Cubica-AI/PROJECT_STRUCTURE.yaml) - current repository layout and workspace map.
- [docs/architecture/PROJECT_ARCHITECTURE.md](/home/abc/projects/Cubica-AI/docs/architecture/PROJECT_ARCHITECTURE.md) - canonical architecture overview and ADR cross-links.
- [docs/architecture/gameplay-slices/README.md](/home/abc/projects/Cubica-AI/docs/architecture/gameplay-slices/README.md) - rules and index for bounded gameplay slice records; use these for delivery-specific migration details instead of ADRs.
- [docs/tasks/AGENTS.md](/home/abc/projects/Cubica-AI/docs/tasks/AGENTS.md) - mandatory local rules for execution planning, subagent-ready decomposition, model/effort selection, and final simplification review.
- [docs/tasks/STRATEGY.md](/home/abc/projects/Cubica-AI/docs/tasks/STRATEGY.md) - product-led development mode, strategic priorities, and rules for selecting platform work.
- [NEXT_STEPS.md](/home/abc/projects/Cubica-AI/NEXT_STEPS.md) - current execution priorities and the next bounded slices.

---

## 4. Work with temporary files

- **Location:** All temporary files (screenshots, debug logs, intermediate artifacts) must be stored in the `.tmp/` directory at the repository root.
- **Naming:** Use descriptive names with timestamps for screenshots (e.g., `.tmp/verification-topbar-2024-05-20.png`).
- **Cleanup:** Agents are responsible for cleaning up their temporary files in `.tmp/` once the task is completed and verified. **Do not leave temporary files in the repository root.**
- **Persistence:** Never commit files from the `.tmp/` directory to the repository.
