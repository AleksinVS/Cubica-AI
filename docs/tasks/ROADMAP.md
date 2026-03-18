# ROADMAP

Назначение: high‑level список планируемых задач для платформы Cubica на уровне Milestone/Epic/Feature/ExecPlan.
Правило: названия невыполненных задач в этом файле отмечаются жирным шрифтом (`**Название задачи**`), выполненные задачи пишутся обычным шрифтом.
Подробные правила ведения roadmap описаны в `docs/tasks/README.md`.

Префиксы: M (Milestone), E (Epic), F (Feature), CP (ExecPlan).
Рекомендуемые правила имени файла: `<ПРЕФИКС>-<ГОД ГГ>-<Счётчик>-kebab-title.md`.
ExecPlan: `CP-YY-XXXXR-<kebab-title родителя-фичи*>.yaml` 
Последняя цифра счетчика (`R`) резервируется для дополнительных задач и планов.
Номер и заголовок ExecPlan отличается от номера родительской задачи только префиксом.
Если нужен ExecPlan без родительской задачи, то используются резервная цифра счетчика.
`YY` - последние две цифры года в котором была создана задача.

Пример оформления дерева задач:
```
- [ ] **Название вехи 1**
      [M-23-010](milestones/M-23-010-alpha.md)

      - [ ] **Название эпика 1**

            - [ ] **Формат JSON-манифеста игр и схем**
                  [F-23-00010](features/F-23-00010-game-manifest-format-and-schema.md)
                        [CP-23-00010](content-packs/CP-23-00010-antarctica-json-manifest.yaml)
            - [x] Пример завершенной фичи
                  [F-23-00011](features/F-23-00011-finished-feature.md)

      - [ ] **Название эпика 2**
            [E-23-0020](epics/E-23-0020-nextjs-game-player.md)

            - [ ] **Название фичи 1**
                  [F-23-00021](features/F-23-00021-json-manifest-(E-23-0020).md)
                  [CP-23-00020](content-packs/CP-23-00020-antarctica-json-manifest.yaml)

- [ ] **MVP**
- [x] Пример завершенной вехи
```
## План реализации (последовательность выполнения ближайших фич, оценка сроков)

### Делаем

### Стоп-лист
**Рефакторинг game-player-nextjs под SDK и целевую архитектуру** [F_00024]
**JSON-манифест сценария «Antarctica» для Next.js-плеера** [F_00021] 
**Antarctica — обучающие метаданные и методические материалы** [F_00023]


## Дерево задач

- [ ] **Alpha-этап игрового плеера**
      [M_010](milestones/M_010_game_player_alpha.md)

    - [ ] **Architecture Review & Consolidation**
          [E_00001](epics/E_00001_architecture_review_consolidation.md)

        - [x] ADR Consolidation & Legacy Cleanup (Sprint 1)
              [F_00001](features/F_00001_adr_consolidation_sprint1_(E_00001).md)

        - [x] Manifest Schemas Enhancement (Sprint 2-3)
              [F_00002](features/F_00002_manifest_schemas_enhancement_(E_00001).md)
              [CP_00002](content-packs/CP_00002_manifest_schemas_enhancement.yaml)

        - [x] Reference Examples for Manifests (Sprint 2-3)
              [F_00003](features/F_00003_reference_examples_for_manifests_(E_00001).md)
              [CP_00003](content-packs/CP_00003_reference_examples_for_manifests.yaml)

        - [x] Manifest Structure Consolidation (Sprint 2-3)
              [F_00004](features/F_00004_manifest_sync_automation_(E_00001).md)
              [CP_00004](content-packs/CP_00004_manifest_sync_automation.yaml)

        - [ ] **SDK Viewers Web Base** (Phase 1)
              [F_00005](features/F_00005_sdk_viewers_web_base_(E_00001).md)
              [CP_00005](content-packs/CP_00005_sdk_viewers_web_base.yaml)

        - [ ] **Security Documentation** (Phase 1)
              [F_00006](features/F_00006_security_documentation_(E_00001).md)
              [CP_00006](content-packs/CP_00006_security_documentation.yaml)

        - [ ] **Training Metadata Guide** (Phase 1)
              [F_00007](features/F_00007_training_metadata_guide_(E_00001).md)
              [CP_00007](content-packs/CP_00007_training_metadata_guide.yaml)

        - [ ] **ADR Documentation Completion** (Phase 1)
              [F_00008](features/F_00008_adr_documentation_completion_(E_00001).md)
              [CP_00008](content-packs/CP_00008_adr_documentation_completion.yaml)

    - [ ] **Observability & Quality Assurance** (Post-MVP)
          [E_0050](epics/E_0050_observability_and_quality.md)

        - [ ] **Testing Strategy for LLM Games**
              [F_00050](features/F_00050_testing_strategy.md)
        - [ ] **Observability Framework**
              [F_00051](features/F_00051_observability_framework.md)
        - [ ] **Rate Limiting & Budget Control**
              [F_00052](features/F_00052_rate_limiting.md)
        

    - [ ] **Архитектура JSON-манифестов игр и LLM-first плеера**
          [E_0010](epics/E_0010_game_manifest_architecture.md)
        
        - [x] Архитектура библиотеки viewers (плееров) для игр Cubica
              [F_00071](features/F_00071_viewers_library_architecture_(E_0010).md)
              [CP_00071](content-packs/CP_00071_viewers_library_architecture.yaml)
        - [x] Архитектура пакетов расширений (Extension Packs) и Гибридная модель Engine
              [F_00073](features/F_00073_extension_packs_architecture_(E_0010).md)

        - [x] Manifest Versioning Strategy
              [F_00040](features/F_00040_manifest_versioning.md)
              
        - [x] Базовый формат JSON-манифеста игр и схем
              [F_00010](features/F_00010_game_manifest_format_and_schema_(E_25_0001).md)
                  [CP_00010](content-packs/CP_00010_game_manifest_format.yaml)
        - [x] Определение схемы UI (Hybrid SDUI)
              [F_00020](features/F_00020_ui_schema_definition.md)
        - [x] Текстовые якоря и разделение логического и UI-манифестов
              [F_00070](features/F_00070_manifest_text_anchors_and_ui_split.md)
                  [CP_00070](content-packs/CP_00070_manifest_text_anchors_and_ui_split.yaml)
        - [x] Дизайн-артефакты для ИИ-агентов в UI-манифесте
              [F_00074](features/F_00074_design_artifacts_for_ai_agents_(E_0010).md)
                  [CP_00074](content-packs/CP_00074_design_artifacts_for_ai_agents.yaml)
        - [x] Протокол взаимодействия Model-View-Presenter
              [F_00011](features/F_00011_mvp_interaction_protocol_(E_0010).md)
                  [CP_00011](content-packs/CP_00011_mvp_interaction_protocol.yaml)
        - [x] Абстрактный протокол представления (Abstract View Protocol)
              [F_00012](features/F_00012_abstract_view_protocol.md)

    - [ ] **Game Engine & Backend Architecture Design**
          [E_0030](epics/E_0030_backend_architecture_design.md)
          
      
        - [ ] **Redis Integration**
              [F_00062](features/F_00062_redis_integration.md)
        - [x] Multiplayer Architecture
              [F_00060](features/F_00060_multiplayer_architecture.md)
        - [ ] **Укрепление очереди событий мультиплеера (ADR-011)**
              [F_00063](features/F_00063_multiplayer_queue_hardening.md)
        - [x] JS Sandbox Security Specification
              [F_00041](features/F_00041_js_sandbox_security.md)
        - [ ] **Session Recovery Mechanism**
              [F_00042](features/F_00042_session_recovery.md)

        - [x] LLM Context Pipeline Architecture
              [F_00030](features/F_00030_llm_context_pipeline.md)
        - [x] Session State Persistence Strategy
              [F_00031](features/F_00031_session_state_persistence.md)
        - [x] View Adapters Deployment Architecture
              [F_00032](features/F_00032_view_adapters_architecture.md)
        - [x] Hybrid Game Engine & Scripting Architecture
              [F_00033](features/F_00033_hybrid_game_engine.md)

    - [ ] **Game Editor Development (MVP)**
          [E_00021](epics/E_00021_game_editor_development.md)

        - [ ] **Game Editor — Architecture**
              [F_00064](features/F_00064_game_editor_architecture_(E_00021).md)

        - [ ] **Game Editor Intelligence**
              [F_00061](features/F_00061_game_editor_intelligence.md)

        - [ ] **Game Editor — Preparatory Dialog** (Этап A)
              [F_00013](features/F_00013_game_editor_preparatory_dialog_(E_00021).md)

        - [ ] **Game Editor — Scenario & Rules Editor** (Этап B)
              [F_00025](features/F_00025_game_editor_scenario_rules_(E_00021).md)

        - [ ] **Game Editor — Mockup Editor** (Этап C)
              [F_00034](features/F_00034_game_editor_mockup_editor_(E_00021).md)

        - [ ] **Game Editor — Prototype Builder** (Этап D)
              [F_00043](features/F_00043_game_editor_prototype_builder_(E_00021).md)

        - [ ] **Game Editor — Debug Mode** (Этап E)
              [F_00053](features/F_00053_game_editor_debug_mode_(E_00021).md)

    - [ ] **Antarctica на Next.js game player**
          [E_0020](epics/E_0020_antarctica_nextjs_game_player.md)

        - [ ] **Рефакторинг game-player-nextjs под SDK и целевую архитектуру** (in_progress)
                  [F_00024](features/F_00024_game_player_nextjs_refactor_(E_0020).md)
                  [CP_00024](content-packs/CP_00024_antarctica_nextjs_refactor.yaml)

        - [x] Antarctica — разделение game/ui манифестов, протокол command/payload и пакет игры в games/
              [F_00072](features/F_00072_antarctica_ui_manifest_actions_and_game_package_(E_0020).md)
                  [CP_00072](content-packs/CP_00072_antarctica_ui_manifest_and_actions.yaml)

        - [ ] **JSON-манифест сценария «Antarctica» для Next.js-плеера**
              [F_00021](features/F_00021_antarctica_json_manifest_(E_0020).md)
                  [CP_00020](content-packs/CP_00020_antarctica_json_manifest.yaml)

        - [ ] **Antarctica — локальная загрузка манифеста и рендер**
              [F_00022](features/F_00022_antarctica_local_loader_and_renderer.md)
                  [CP_00022](content-packs/CP_00022_antarctica_local_loader.yaml)
                  
        - [ ] **Antarctica — обучающие метаданные и методические материалы**
              [F_00023](features/F_00023_antarctica_training_metadata_and_methodology.md)
                  [CP_00023](content-packs/CP_00023_antarctica_methodology.yaml)
