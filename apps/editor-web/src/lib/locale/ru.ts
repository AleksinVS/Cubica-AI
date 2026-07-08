/**
 * Russian locale strings for the editor UI chrome (framework-free).
 *
 * "chrome" = the tool's framing shell: the top toolbar, side panels, tabs, the
 * status strip, button labels and screen-reader labels (aria-label/title) — as
 * opposed to the "content" (the author's game data, which carries its own text
 * from the manifest). Owner decision 2026-07-08 (LEGACY-0041 /
 * TSK-20260708): the editor UI is Russian, single-locale.
 *
 * Why a single module (mirrors apps/player-web/src/lib/locale/ru.ts):
 * - Localization / wording changes are a single-file edit, not a hunt across
 *   ~24 components.
 * - AI agents and newcomers find and adjust UI text in one place.
 * - No drift: components never hardcode a user-facing English literal again.
 *
 * The object is framework-free (no React import) so it can stay in the lib/
 * layer; components import it directly as `t`
 * (`import { editorRu as t } from "@/lib/locale"`).
 *
 * Grouped by chrome area. Keys carry short comments explaining where each
 * string appears, because a newcomer cannot always tell from the key alone.
 */

export const editorRu = {
  /** Top toolbar (mockup zone 1): brand, mode axes, action buttons. */
  toolbar: {
    /** Product brand shown at the toolbar's left edge. */
    brand: "Редактор Cubica",
    /** Toolbar landmark label (screen readers). */
    toolbarAria: "Панель инструментов редактора",

    /** Дизайн/Превью axis label (screen readers). */
    editorModeAria: "Режим редактора",
    /** Design axis: author edits against a chosen state. */
    modeDesign: "Дизайн",
    /** Preview axis: play the game as a player would. */
    modePreview: "Превью",

    /** Play/Осмотр axis label (screen readers). */
    previewModeAria: "Режим предпросмотра",
    /** Interact with the running preview as a player. */
    play: "Игра",
    /** Point-and-select preview elements to edit them. */
    inspect: "Осмотр",

    /** Viewport size axis label (screen readers). */
    viewportAria: "Размер экрана",
    /** Desktop viewport preset. */
    viewportDesktop: "Десктоп",
    /** Tablet viewport preset. */
    viewportTablet: "Планшет",
    /** Phone viewport preset. */
    viewportMobile: "Телефон",

    /** Game selector label (screen readers). */
    gameAria: "Игра",
    /** Authoring-file selector label (screen readers). */
    fileAria: "Файл авторинга",
    /** Placeholder option when no repository game is loaded. */
    embedded: "встроенная",
    /** Placeholder option when no repository file is loaded. */
    embeddedSample: "встроенный образец",

    /** Discard local changes to the active file. */
    reset: "Сброс",
    /** Save the active file into the session worktree. */
    save: "Сохранить",
    /** Undo the last AI/edit change. */
    undo: "Отменить",
    /** Redo the last undone change. */
    redo: "Повторить",
    /** Run validation over the active document. */
    validate: "Проверить",
    /** Compile the authoring manifests. */
    compile: "Собрать",
    /** Compile + render the interactive preview. */
    preview: "Предпросмотр",

    /**
     * Tooltip on an action disabled by blocking errors (Вариант А). `{count}` is
     * the number of error-severity diagnostics; clicking the status/checks
     * counter or the plate button jumps to the first one.
     */
    blockedByErrors: (count: number) =>
      `Нельзя, пока есть блокирующие ошибки: ${count}. Откройте «Проверки» и исправьте первую.`
  },

  /** Bottom status/diagnostics strip (mockup zone 7). */
  statusBar: {
    /** Diagnostics footer landmark label (screen readers). */
    diagnosticsAria: "Диагностика",
    /** Status region label (screen readers). */
    statusAria: "Статус редактора",
    /** Leading "Status" caption. */
    status: "Статус",
    /** Preview interaction mode caption, e.g. "Режим: Осмотр". */
    mode: "Режим",
    /** Alt-play suffix shown next to the mode. */
    altSuffix: " (Alt)",
    /** Viewport caption. */
    viewport: "Экран",
    /** Preview not yet compiled. */
    previewNotPrepared: "Превью: не готово",
    /** Preview ready with N selectable entities. */
    previewSelectable: (count: number) => `Превью: выбираемых ${count}`,
    /** Runtime trace event count. */
    traceEvents: (count: number) => `событий трассы: ${count}`,
    /** Workflow state caption. */
    workflow: "Процесс",
    /** Preview rollback state caption. */
    rollback: "Откат",
    /** Compact Checks counter tooltip. */
    openChecks: "Открыть «Проверки»",
    /** Checks counter label; "ок" when there is nothing actionable. */
    checks: "Проверки",
    checksOk: "ок",
    /** Current selection caption. */
    selection: "Выбор",
    /** "no selection" value. */
    none: "нет",
    /** Flow edge count. */
    edges: (count: number) => `связей: ${count}`,
    /** Diagnostics list caption. */
    diagnostics: "Диагностика",
    /** Empty diagnostics state. */
    noBlockingDiagnostics: "Нет блокирующих проблем",
    /** AI apply summary "+N more" tail. */
    andMore: (count: number) => `; ещё ${count}`,

    /** Human viewport-preset value for the "Экран: …" readout. */
    viewportValue: (mode: "desktop" | "tablet" | "mobile") =>
      mode === "desktop" ? "десктоп" : mode === "tablet" ? "планшет" : "телефон",
    /** Human label for the raw workflow state token in the "Процесс: …" readout. */
    workflowLabel: {
      idle: "ожидание",
      validating: "проверка",
      validated: "проверено",
      compiling: "сборка",
      compiled: "собрано",
      previewing: "предпросмотр",
      ready: "готово",
      blocked: "заблокировано",
      error: "ошибка"
    } as Record<string, string>,
    /** Human label for the preview-rollback state token in the "Откат: …" readout. */
    rollbackLabel: {
      idle: "нет",
      restoring: "восстановление",
      restored: "восстановлено",
      blocked: "заблокировано",
      error: "ошибка"
    } as Record<string, string>,
    /** Human label for the AI apply state token in the AI diff summary. */
    aiStateLabel: {
      idle: "ожидание",
      planning: "планирование",
      applying: "применение",
      applied: "применено",
      blocked: "заблокировано",
      error: "ошибка",
      undone: "отменено"
    } as Record<string, string>
  },

  /**
   * Sync status word shown in the status strip (source: getSyncLabel). Reflects
   * the load/save/dirty/blocked state of the active document in one word.
   */
  sync: {
    loading: "Загрузка",
    fallback: "Запасной образец",
    saving: "Сохранение…",
    conflict: "Конфликт",
    error: "Ошибка",
    blocked: "Заблокировано",
    dirty: "Есть изменения",
    saved: "Сохранено",
    clean: "Без изменений"
  },

  /** Vertical activity bar toggling the sidebars (mockup zone 2). */
  activityBar: {
    /** Activity-bar landmark label (screen readers). */
    sidebarsAria: "Боковые панели редактора",
    /** Manifest tree panel. */
    tree: "Дерево",
    /** Short glyph caption for the tree button. */
    treeGlyph: "Дер",
    /** Timeline panel. */
    timeline: "Таймлайн",
    /** Short glyph caption for the timeline button. */
    timelineGlyph: "Врм",
    /** AI chat panel. */
    aiChat: "ИИ-чат",
    /** Short glyph caption for the AI chat button. */
    aiChatGlyph: "ИИ",
    /** Assets panel (already Russian in the mockup). */
    assets: "Ассеты",
    /** Short glyph caption for the assets button. */
    assetsGlyph: "Асс",
    /** Checks panel (already Russian in the mockup). */
    checks: "Проверки",
    /** Short glyph caption for the checks button. */
    checksGlyph: "Прв",
    /** JSON editor panel. */
    json: "JSON"
  },

  /** Preview mode banner over the canvas (mockup zone 3). */
  previewBanner: {
    /** Banner landmark label (screen readers). */
    bannerAria: "Баннер режима предпросмотра"
  },

  /** Right sidebar: Monaco JSON editor or property panel (mockup zone 6). */
  rightSidebar: {
    /** JSON editor landmark label (screen readers). */
    jsonEditorAria: "JSON-редактор авторинга",
    /** Property panel landmark label (screen readers). */
    propertiesAria: "Свойства выбранного узла",
    /** Resize handle label (screen readers). */
    resizeAria: "Изменить ширину правой панели",
    /** JSON panel heading. */
    authoringJson: "JSON авторинга",
    /** Diagnostics count next to the heading. */
    diagnosticsCount: (count: number) => `проблем: ${count}`,
    /** Empty diagnostics state (shared wording with the status bar). */
    noBlockingDiagnostics: "Нет блокирующих проблем",
    /** Collapse the panel. */
    collapse: "Свернуть"
  },

  /** Strings shared by several panels. */
  common: {
    /** Collapse a panel. */
    collapse: "Свернуть",
    /** Expand a collapsed tree node. */
    expand: "Развернуть",
    /** Nothing selected. */
    noSelection: "Нет выбора",
    /** "none" value. */
    none: "нет",
    /** Unknown value. */
    unknown: "неизвестно",
    /** "N matches" count for tree search results. */
    matches: (count: number) => `совпадений: ${count}`
  },

  /** Preview stage: embedded player iframe + empty states (mockup zone 3/5). */
  previewStage: {
    /** Stage landmark label (screen readers). */
    stageAria: "Предпросмотр игры",
    /** Embedded player iframe title (screen readers). */
    iframeTitle: "Предпросмотр игры",
    /** Empty-state title when nothing is selected. */
    noSelection: "Нет выбора",
    /** Button that compiles + renders the interactive preview. */
    preparePreview: "Подготовить превью"
  },

  /** Left sidebar host: manifest surface tabs + collapse/resize (mockup zone 4). */
  leftSidebar: {
    /** Manifest-navigation landmark label (screen readers). */
    manifestNavAria: "Навигация по манифесту",
    /** Manifest panel heading. */
    manifest: "Манифест",
    /** Surface-tabs group label (screen readers). */
    viewsAria: "Виды манифеста",
    /** Nested JSON tree surface tab. */
    surfaceTree: "Дерево",
    /** Semantic graph surface tab. */
    surfaceGraph: "Граф",
    /** Entity outliner surface tab. */
    surfaceEntities: "Сущности",
    /** Collapse-manifest button label (screen readers). */
    collapseManifestAria: "Свернуть панель манифеста",
    /** Resize handle label (screen readers). */
    resizeAria: "Изменить ширину левой панели"
  },

  /** Timeline sidebar panel (mockup zone 6). */
  timeline: {
    /** Panel heading. */
    title: "Таймлайн",
    /** Runtime-trace section label (screen readers). */
    runtimeTraceAria: "Трасса выполнения",
    /** Runtime section heading. */
    runtime: "Выполнение",
    /** Empty runtime trace state. */
    noRuntimeEvents: "Нет событий выполнения",
    /** Per-event inspect tooltip. */
    inspectEvent: (sequence: number) => `Разобрать событие предпросмотра ${sequence}`,
    /** "Current" marker on the active trace event. */
    current: "Текущее"
  },

  /** Trace detail panel for one selected preview event. */
  traceDetail: {
    /** Detail panel landmark label (screen readers). */
    detailsAria: "Детали трассы предпросмотра",
    /** Panel heading. */
    title: "Трасса предпросмотра",
    /** "Current TN / none" caption. */
    current: "Текущее",
    /** Selected event caption. */
    selected: "Выбрано",
    /** Event kind caption. */
    kind: "Тип",
    /** Snapshot availability caption. */
    snapshot: "Снимок",
    /** Snapshot present. */
    available: "есть",
    /** Snapshot absent. */
    missing: "нет",
    /** Restore the selected snapshot. */
    restoreSelected: "Восстановить выбранное",
    /** Rewind the preview to the start. */
    resetToStart: "В начало",
    /** Re-run to the current step. */
    replayCurrent: "Повторить текущее",
    /** Payload block label (screen readers). */
    payloadAria: "Данные выбранного события трассы"
  },

  /** Grouped entity tree panel (mockup zone 4). */
  entityTree: {
    /** Tree section landmark label (screen readers). */
    treeAria: "Дерево сущностей",
    /** Tree rows list label (screen readers). */
    rowsAria: "Строки дерева сущностей",
    /** Panel heading. */
    entities: "Сущности",
    /** Search box label (screen readers). */
    searchAria: "Поиск сущностей",
    /** Search box placeholder. */
    searchPlaceholder: "Поиск по имени, типу, диагностике…",
    /** "No matches" empty state. */
    noMatches: "Нет совпадений.",
    /** Grouping segmented-control label (screen readers). */
    groupingAria: "Группировка дерева сущностей",
    /** Create-menu dialog label (screen readers). */
    createEntityAria: "Создать сущность",
    /** New-entity label input (screen readers). */
    newLabelAria: "Название новой сущности",
    /** Type search input label (screen readers). */
    searchTypesAria: "Поиск типов",
    /** Type list label (screen readers). */
    typesAria: "Типы"
  },

  /** JSON tree surface (nested authoring outline). */
  jsonTree: {
    /** Tree section landmark label (screen readers). */
    treeAria: "JSON-дерево авторинга",
    /** Panel heading. */
    tree: "Дерево",
    /** Search box label (screen readers). */
    searchAria: "Поиск по дереву",
    /** Search box placeholder. */
    searchPlaceholder: "Поиск: ключ/значение/тип/id/заголовок",
    /** Node count meta. */
    nodes: (count: number) => `узлов: ${count}`,
    /** Tree rows list label (screen readers). */
    rowsAria: "Строки JSON-дерева"
  },

  /** Floating entity inspector (mockup zone 5). Visible text is already Russian. */
  inspector: {
    /** Inspector landmark label (screen readers). */
    inspectorAria: "Инспектор сущности",
    /** Editable label input (screen readers). */
    labelAria: "Название сущности",
    /** Rename button label (screen readers). */
    renameAria: "Переименовать id сущности",
    /** Delete button label (screen readers). */
    deleteAria: "Удалить сущность",
    /** Source-text-mode toggle label (screen readers). */
    sourceModeAria: "Текстовый режим источника",
    /** Pin-to-dock button label (screen readers). */
    pinAria: "Закрепить в док (скоро)",
    /** Close button label (screen readers). */
    closeAria: "Закрыть инспектор сущности",
    /** View-channel selector label (screen readers). */
    viewChannelAria: "Канал вида",
    /** Element prompt input label (screen readers). */
    promptAria: "Промт элемента"
  },

  /** Source text mode ("источник"). Visible text is already Russian. */
  sourceText: {
    /** Editable projection textarea label (screen readers). */
    projectionAria: "Текст проекции источника",
    /** Interpretation report block label (screen readers). */
    reportAria: "Отчёт интерпретации"
  },

  /** Entity refactor dialogs. Visible text is already Russian. */
  refactorDialog: {
    /** Delete dialog label (screen readers). */
    deleteAria: "Удалить сущность",
    /** Rename dialog label (screen readers). */
    renameAria: "Переименовать id сущности",
    /** Facets section label (screen readers). */
    facetsAria: "Фасеты",
    /** Incoming references section label (screen readers). */
    incomingAria: "Входящие ссылки",
    /** Retarget block label (screen readers). */
    retargetAria: "Перенацелить ссылки",
    /** Retarget-target selector label (screen readers). */
    retargetTargetAria: "Цель перенацеливания",
    /** New-id input label (screen readers). */
    newIdAria: "Новый id сущности",
    /** Close-dialog button label (screen readers). */
    closeAria: "Закрыть диалог"
  },

  /** Property panel + graph operations (mockup zone 6, developer surface). */
  propertyPanel: {
    /** Panel landmark label (screen readers). */
    propertiesAria: "Свойства выбранного узла",
    /** Panel heading. */
    properties: "Свойства",
    /** Nothing selected. */
    noSelection: "Нет выбора",
    /** Empty state when the selected node has no editable fields. */
    selectNode: "Выберите узел JSON с редактируемыми полями.",
    /** Commit the edited raw JSON of a complex value. */
    applyJson: "Применить JSON",
    /** Reveal the field in the JSON editor. */
    openInJson: "Открыть в JSON",
    /** Graph-operations section label (screen readers). */
    graphAria: "Операции графа",
    /** Graph-operations heading. */
    graph: "Граф",
    /** Add-collection-item block caption. */
    addCollectionItem: "Добавить элемент коллекции",
    /** New-item key placeholder. */
    itemKeyPlaceholder: "ключ элемента",
    /** Add the collection item. */
    add: "Добавить",
    /** Remove the selected collection item. */
    removeSelected: "Удалить выбранное",
    /** Reference block caption. */
    reference: "Ссылка",
    /** Connect the reference to the chosen target. */
    connect: "Связать",
    /** Clear the reference link. */
    disconnect: "Отвязать"
  },

  /** «Проверки» sidebar panel. */
  checks: {
    /** Collapse button label (screen readers). */
    collapseAria: "Свернуть панель проверок",
    /** Row quick fix: add the missing UI view for a game entity. */
    createView: "Создать вид",
    /** Row quick fix: fill a missing `_label` with a derived default (Вариант А). */
    fillLabel: "Заполнить подпись",
    /** Row action: hand the diagnostic to the agent as an intent. */
    fixWithAgent: "Исправить агентом",
    /** Group-level bulk fix button. */
    fixAll: (count: number) => `Исправить все (${count})`
  },

  /** «Ассеты» sidebar panel. Visible text is already Russian. */
  assets: {
    /** Collapse button label (screen readers). */
    collapseAria: "Свернуть панель ассетов"
  },

  /** Fallback AI chat sidebar (when the CopilotKit chat is unavailable). */
  aiChat: {
    /** Panel heading. */
    title: "ИИ-чат",
    /** Apply-state caption. */
    state: "Состояние",
    /** Selection caption. */
    selection: "Выбор",
    /** Last prompt caption. */
    lastPrompt: "Последний промт",
    /** Last diff caption. */
    lastDiff: "Последний дифф",
    /** Prototype proposal caption. */
    prototypeProposal: "Предложение прототипа",
    /** Gate passed marker. */
    ok: "ок",
    /** Gate blocked marker. */
    blocked: "заблокировано",
    /** Promote the proposal into a planned ChangeSet. */
    useAsPlanned: "Использовать как запланированную правку"
  },

  /** CopilotKit-backed editor assistant chat chrome. */
  agentChat: {
    /** Panel heading. */
    title: "ИИ-чат",
    /** Chat modal header title. */
    modalHeaderTitle: "Ассистент редактора",
    /** Chat welcome message. */
    welcome:
      "Опишите ограниченное изменение авторинга. Я спланирую EditorChangeSet, и Cubica проверит его перед применением.",
    /** Chat input placeholder. */
    inputPlaceholder: "Опишите изменение для выбранного объекта",
    /** Agent-connection section caption. */
    connection: "Подключение агента",
    /** Hint shown when the AG-UI backend is not attached. */
    backendHint: "Задайте CUBICA_EDITOR_AGENT_AG_UI_URL и перезапустите editor-web, чтобы подключить бэкенд AG-UI.",
    /** Approval-required section caption. */
    approvalRequired: "Требуется подтверждение",
    /** Approve the pending operation. */
    approve: "Подтвердить",
    /** Reject the pending operation. */
    reject: "Отклонить",
    /** Reason recorded when the author rejects an approval. */
    rejectedReason: "Отклонено пользователем редактора.",
    /** Agent runtime status words. */
    statusChecking: "Проверка",
    statusReady: "Готов",
    statusRuntimeDisabled: "Runtime выключен",
    statusBackendMissing: "Нет бэкенда",
    statusError: "Ошибка",
    statusDisabled: "Выключено",
    /** Agent runtime status messages. */
    msgDisabled: "ИИ-помощник выключен.",
    msgChecking: "Проверяем среду агента.",
    msgReady: "Среда агента готова.",
    msgBackendMissing: "Бэкенд AG-UI не настроен.",
    msgRuntimeDisabled: "Среда агента выключена.",
    msgStatusFailed: "Проверка статуса среды агента не удалась.",
    /** Runtime returned a non-OK HTTP status. */
    msgHttp: (status: number) => `Среда агента вернула HTTP ${status}.`
  },

  /** Prototype-audit freshness footer notice (ADR-050). */
  prototypeAudit: {
    /** Last completed run caption. */
    lastCompleted: "Последний прогон",
    /** LLM status caption. */
    llmStatus: "Статус ИИ",
    /** Candidates caption. */
    candidates: "Кандидаты",
    /** Report path caption. */
    report: "Отчёт",
    /** Link to the audit workflow. */
    openWorkflow: "Открыть процесс аудита",
    /** Dismiss the notice for the session. */
    snooze: "Отложить на сессию",
    /** Summary lines per notice kind. */
    summaryMissing: "Аудит прототипов: отсутствует",
    summaryStale: "Аудит прототипов: устарел",
    summaryFailed: "Аудит прототипов: сбой",
    summaryPartial: "Аудит прототипов: частичный",
    summaryOutdated: "Аудит прототипов: отчёт просрочен",
    /** Candidate counts summary. */
    candidateSummary: (deterministic: number, semantic: number, promotion: number) =>
      `${deterministic} детерминированных, ${semantic} смысловых, ${promotion} к продвижению`
  },

  /** Manifest-driven agent surface fallbacks (editor-cubica-surface). */
  agentSurface: {
    /** Default title for the diagnostics surface block. */
    diagnostics: "Диагностика",
    /** Default title for the diff-summary surface block. */
    diffSummary: "Сводка изменений",
    /** Default title for the approval surface block. */
    approval: "Подтверждение",
    /** Unknown manifest Surface component fallback. */
    unsupported: "Неподдерживаемый компонент поверхности"
  },

  /** Preview inspect overlay (selection layer, object menu, region prompt). */
  selectionOverlay: {
    /** Selection layer landmark label (screen readers). */
    layerAria: "Слой выбора предпросмотра",
    /** Selected-object label (screen readers). */
    selectedObjectAria: (label: string) => `Выбранный объект предпросмотра: ${label}`,
    /** Object menu heading. */
    objects: "Объекты",
    /** Region prompt heading. */
    regionPrompt: "Промт для области",
    /** Object prompt heading. */
    objectPrompt: "Промт для объекта",
    /** Prompt textarea label (screen readers). */
    promptAria: "Промт ИИ",
    /** Prompt placeholder for a single object. */
    promptPlaceholderOne: "Опишите изменение",
    /** Prompt placeholder for several objects. */
    promptPlaceholderMany: (count: number) => `Опишите изменение для ${count} объектов`,
    /** Last-intent caption. */
    lastIntent: "Последнее намерение редактора",
    /** Number of target pointers on the last intent. */
    targetPointers: (count: number) => `целевых указателей: ${count}`,
    /** Visible close button in the object menu / prompt head. */
    close: "Закрыть",
    /** Layers picker button (many overlapping objects). */
    layers: "Слои",
    /** Submit the prompt as an editor intent. */
    applyChange: "Применить изменение",
    /** Close object menu button (screen readers). */
    closeMenuAria: "Закрыть меню объекта",
    /** Close prompt button (screen readers). */
    closePromptAria: "Закрыть промт предпросмотра"
  },

  /** Top-level workspace shell. */
  workspace: {
    /** Workspace landmark label (screen readers). */
    workspaceAria: "Рабочее пространство редактора авторинга"
  }
} as const;

/** The shape of the editor chrome strings (single source of truth). */
export type EditorStrings = typeof editorRu;
