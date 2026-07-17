#!/usr/bin/env node
/**
 * Migrates existing authoring manifests to the semantic authoring v2 shape.
 *
 * The script intentionally uses generated runtime manifests as the factual
 * source for runtime-facing fields. The current authoring files are large and
 * prototype-heavy, so rebuilding v2 from runtime JSON keeps the migration
 * deterministic and avoids unsafe hand-written rewrites in model context.
 */

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function relativePath(filePath) {
  return path.relative(repoRoot, filePath).replace(/\\/g, "/");
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function compactText(value, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }
  const text = value
    .replace(/<[^>]*>/g, " ")
    .replace(/{{[^}]+}}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 0 ? text.slice(0, 96) : fallback;
}

function hasCyrillic(value) {
  return /[А-Яа-яЁё]/.test(String(value));
}

function cleanLabel(value, fallback) {
  const text = compactText(value, fallback);
  const dashParts = text.split(/\s+-\s+/);
  if (dashParts.length > 1) {
    const lastPart = dashParts[dashParts.length - 1].trim();
    if (hasCyrillic(lastPart)) {
      return lastPart;
    }
  }
  return text;
}

function titleFromId(id, prefix) {
  return `${prefix} ${String(id).replace(/[_.:-]+/g, " ")}`.replace(/\s+/g, " ").trim();
}

function semanticEnvelope(type, label, semantics, value) {
  return {
    _type: type,
    _label: label,
    _semantics: semantics,
    ...value
  };
}

function labelFromRuntimeObject(value, fallback) {
  if (!isPlainObject(value)) {
    return fallback;
  }
  return cleanLabel(
    value.title || value.name || value.displayName || value.caption || value.summary || value.description,
    fallback
  );
}

function gameContentType(collectionName) {
  const map = {
    boards: "game.Board",
    cards: "game.Card",
    choices: "game.Choice",
    infos: "game.Info",
    teamSelections: "game.TeamSelection"
  };
  return map[collectionName] || "game.ContentEntity";
}

function gameContentLabelPrefix(collectionName) {
  const map = {
    boards: "Доска",
    cards: "Карточка",
    choices: "Выбор",
    infos: "Инфо",
    teamSelections: "Выбор команды"
  };
  return map[collectionName] || "Контент";
}

function annotateGameContent(value, collectionName) {
  if (Array.isArray(value)) {
    return value.map((item) => annotateGameContent(item, collectionName));
  }
  if (!isPlainObject(value)) {
    return value;
  }

  const annotatedEntries = {};
  for (const [key, child] of Object.entries(value)) {
    annotatedEntries[key] = annotateGameContent(child, key);
  }

  const hasEntitySignal = typeof value.id === "string" || typeof value.title === "string" || typeof value.name === "string" || typeof value.displayName === "string";
  if (!hasEntitySignal || collectionName === "data") {
    return annotatedEntries;
  }

  const fallback = titleFromId(value.id || value.key || collectionName, gameContentLabelPrefix(collectionName));
  return semanticEnvelope(
    gameContentType(collectionName),
    labelFromRuntimeObject(value, fallback),
    `Сущность игрового контента из коллекции ${collectionName}.`,
    annotatedEntries
  );
}

function buildGameFlows(manifest) {
  const infos = manifest.content && manifest.content.data && Array.isArray(manifest.content.data.infos)
    ? manifest.content.data.infos
    : [];
  if (infos.length > 0) {
    const sortedInfos = [...infos].sort((left, right) => {
      const leftIndex = typeof left.stepIndex === "number" ? left.stepIndex : Number.MAX_SAFE_INTEGER;
      const rightIndex = typeof right.stepIndex === "number" ? right.stepIndex : Number.MAX_SAFE_INTEGER;
      return leftIndex - rightIndex;
    });
    const steps = sortedInfos.map((info, index) => {
      const stepId = String(info.id || `info.${index}`);
      const actionIds = typeof info.advanceActionId === "string" ? [info.advanceActionId] : [];
      const nextInfo = sortedInfos[index + 1];
      return {
        id: `info.${stepId}`,
        _type: "game.Step",
        _label: labelFromRuntimeObject(info, titleFromId(stepId, "Шаг")),
        _semantics: "Шаг линейного прохождения, восстановленный из content.data.infos.",
        screenId: info.screenId,
        actionIds,
        ...(nextInfo ? { next: `info.${String(nextInfo.id || index + 1)}` } : {})
      };
    });
    return [
      {
        id: "main",
        _type: "game.Flow",
        _label: "Основная хронология",
        _semantics: "Линейная хронология прохождения, построенная из информационных шагов.",
        pattern: "pearl-string",
        steps
      }
    ];
  }

  const timeline = manifest.state && manifest.state.public && manifest.state.public.timeline
    ? manifest.state.public.timeline
    : {};
  const screenId = timeline.screenId || timeline.screen_id || manifest.entry_point || "start";
  return [
    {
      id: "main",
      _type: "game.Flow",
      _label: "Основной поток",
      _semantics: "Минимальный поток для игры без явной коллекции сценарных шагов.",
      pattern: "pearl-string",
      steps: [
        {
          id: "main.start",
          _type: "game.Step",
          _label: "Начальное состояние",
          _semantics: "Начальный шаг, восстановленный из runtime state.",
          screenId,
          actionIds: Object.keys(manifest.actions || {})
        }
      ]
    }
  ];
}

function collectActionLabelIndex(manifest) {
  const labels = new Map();
  const infosById = new Map();
  const data = manifest.content && manifest.content.data ? manifest.content.data : {};

  function remember(actionId, label) {
    if (typeof actionId === "string" && label && !labels.has(actionId)) {
      labels.set(actionId, label);
    }
  }

  function walk(value) {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!isPlainObject(value)) {
      return;
    }
    const label = labelFromRuntimeObject(value, "");
    if (typeof value.id === "string" && label) {
      infosById.set(value.id, label);
    }
    remember(value.selectActionId, label ? `Выбрать: ${label}` : "");
    remember(value.actionId, label ? `Действие: ${label}` : "");
    remember(value.advanceActionId, label ? `Продолжить: ${label}` : "");
    for (const child of Object.values(value)) {
      walk(child);
    }
  }

  walk(data);
  return { labels, infosById };
}

function actionLabel(actionId, action, actionLabels) {
  const indexedLabel = actionLabels.labels.get(actionId);
  if (indexedLabel) {
    return indexedLabel;
  }

  const displayName = String(action.displayName || action.description || "");
  const infoTarget = displayName.match(/advance to info ([a-zA-Z0-9_]+)/i);
  if (infoTarget && actionLabels.infosById.has(infoTarget[1])) {
    return `Перейти к: ${actionLabels.infosById.get(infoTarget[1])}`;
  }
  if (/relocation aftermath/i.test(displayName)) {
    return "Перейти к последствиям переезда";
  }

  const label = labelFromRuntimeObject(action, titleFromId(actionId, "Действие"));
  return hasCyrillic(label) ? label : `Действие: ${label}`;
}

function migrateGameManifest(gameId) {
  const gameRoot = path.join(repoRoot, "games", gameId);
  const runtimeFile = path.join(gameRoot, "game.manifest.json");
  const authoringFile = path.join(gameRoot, "authoring", "game.authoring.json");
  if (!fs.existsSync(runtimeFile) || !fs.existsSync(authoringFile)) {
    return null;
  }

  const manifest = readJson(runtimeFile);
  const root = {
    _type: "game.Game",
    _label: manifest.meta && manifest.meta.name && hasCyrillic(manifest.meta.name) ? manifest.meta.name : titleFromId(manifest.meta && manifest.meta.name ? manifest.meta.name : gameId, "Игра"),
    _semantics: manifest.meta && manifest.meta.description ? manifest.meta.description : "Корневая сущность game authoring v2."
  };

  for (const [key, value] of Object.entries(manifest)) {
    if (key === "actions") {
      continue;
    }
    root[key] = key === "content" ? annotateGameContent(value, "content") : clone(value);
  }

  const actionLabels = collectActionLabelIndex(manifest);
  const logic = {
    _type: "game.Logic",
    _label: "Логика игры",
    _semantics: "Сценарные потоки, правила и действия authoring-манифеста.",
    flows: buildGameFlows(manifest),
    systems: [],
    rules: [],
    actions: Object.entries(manifest.actions || {}).map(([actionId, action]) => ({
      id: actionId,
      _type: "game.Action",
      _label: actionLabel(actionId, action, actionLabels),
      _semantics: action.description || `Игровое действие ${actionId}.`,
      ...clone(action)
    }))
  };
  root.logic = logic;

  return {
    filePath: authoringFile,
    value: {
      $schema: "../../../docs/architecture/schemas/game-authoring-v2.schema.json",
      _schemaVersion: "2.0",
      _manifestType: "game",
      _definitions: {},
      root
    }
  };
}

function componentLabel(component) {
  const props = isPlainObject(component.props) ? component.props : {};
  const byProps = cleanLabel(props.caption || props.title || props.label || props.html, "");
  if (byProps) {
    return byProps;
  }
  const typeLabels = {
    areaComponent: "Область",
    buttonComponent: "Кнопка",
    cardComponent: "Карточка",
    gameVariableComponent: "Метрика",
    helperComponent: "Помощник",
    imageComponent: "Изображение",
    inputComponent: "Поле ввода",
    richTextComponent: "Текст",
    screenComponent: "Корневой контейнер",
    textComponent: "Текст"
  };
  if (component.id) {
    return titleFromId(component.id, typeLabels[component.type] || "Компонент");
  }
  if (props.cssClass && component.type !== "screenComponent") {
    return `${typeLabels[component.type] || "Компонент"} ${String(props.cssClass).replace(/[-_]+/g, " ")}`;
  }
  return typeLabels[component.type] || titleFromId(component.type || "component", "Компонент");
}

function annotateUiComponent(component) {
  if (!isPlainObject(component)) {
    return component;
  }
  const result = {
    _type: "ui.Component",
    _label: componentLabel(component),
    _semantics: `UI-компонент типа ${component.type || "unknown"}.`
  };
  for (const [key, value] of Object.entries(component)) {
    result[key] = key === "children" && Array.isArray(value)
      ? value.map((child) => annotateUiComponent(child))
      : clone(value);
  }
  return result;
}

function screenLabel(screenId, screen) {
  const title = labelFromRuntimeObject(screen, "");
  return title ? `Экран ${screenId}: ${title}` : titleFromId(screenId, "Экран");
}

function gameDisplayName(gameId) {
  const gameManifestFile = path.join(repoRoot, "games", gameId, "game.manifest.json");
  if (!fs.existsSync(gameManifestFile)) {
    return gameId;
  }
  const manifest = readJson(gameManifestFile);
  return manifest.meta && manifest.meta.name ? manifest.meta.name : gameId;
}

function migrateUiManifest(gameId, channel) {
  const gameRoot = path.join(repoRoot, "games", gameId);
  const runtimeFile = path.join(gameRoot, "ui", channel, "ui.manifest.json");
  const authoringFile = path.join(gameRoot, "authoring", "ui", `${channel}.authoring.json`);
  if (!fs.existsSync(runtimeFile) || !fs.existsSync(authoringFile)) {
    return null;
  }

  const manifest = readJson(runtimeFile);
  const root = {
    _type: "ui.Manifest",
    _label: `${channel === "web" ? "Web" : channel === "telegram" ? "Telegram" : channel}-интерфейс: ${gameDisplayName(gameId)}`,
    _semantics: "Корневая сущность UI authoring v2."
  };

  for (const [key, value] of Object.entries(manifest)) {
    if (key !== "screens") {
      root[key] = clone(value);
      continue;
    }
    root.screens = Object.entries(value || {}).map(([screenId, screen]) => ({
      id: screenId,
      _type: "ui.Screen",
      _label: screenLabel(screenId, screen),
      _semantics: `Экран UI-манифеста ${screenId}.`,
      ...Object.fromEntries(
        Object.entries(screen).map(([screenKey, screenValue]) => [
          screenKey,
          screenKey === "root" ? annotateUiComponent(screenValue) : clone(screenValue)
        ])
      )
    }));
  }

  return {
    filePath: authoringFile,
    value: {
      $schema: "../../../../docs/architecture/schemas/ui-authoring-v2.schema.json",
      _schemaVersion: "2.0",
      _manifestType: "ui",
      _channel: channel,
      _definitions: {},
      root
    }
  };
}

function discoverGameIds(options = {}) {
  const gamesRoot = path.join(repoRoot, "games");
  return fs.readdirSync(gamesRoot)
    .filter((entry) => !options.gameId || entry === options.gameId)
    .filter((entry) => fs.statSync(path.join(gamesRoot, entry)).isDirectory())
    .sort();
}

function discoverChannels(gameId) {
  const uiRoot = path.join(repoRoot, "games", gameId, "ui");
  if (!fs.existsSync(uiRoot)) {
    return [];
  }
  return fs.readdirSync(uiRoot)
    .filter((entry) => fs.existsSync(path.join(uiRoot, entry, "ui.manifest.json")))
    .sort();
}

function collectMigrationJobs(options = {}) {
  const jobs = [];
  for (const gameId of discoverGameIds(options)) {
    const gameJob = migrateGameManifest(gameId);
    if (gameJob) {
      jobs.push(gameJob);
    }
    for (const channel of discoverChannels(gameId)) {
      const uiJob = migrateUiManifest(gameId, channel);
      if (uiJob) {
        jobs.push(uiJob);
      }
    }
  }
  return jobs;
}

function parseArgs(argv) {
  const options = {
    check: false,
    write: false,
    gameId: null
  };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--check" || arg === "--dry-run") {
      options.check = true;
    } else if (arg === "--write") {
      options.write = true;
    } else if (arg === "--game") {
      options.gameId = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (options.check === options.write) {
    throw new Error("Use exactly one of --check/--dry-run or --write.");
  }
  return options;
}

function run(options) {
  const jobs = collectMigrationJobs(options);
  const changes = [];
  for (const job of jobs) {
    const nextText = `${JSON.stringify(job.value, null, 2)}\n`;
    const currentText = fs.existsSync(job.filePath) ? fs.readFileSync(job.filePath, "utf8") : "";
    if (currentText !== nextText) {
      changes.push(relativePath(job.filePath));
      if (options.write) {
        writeJson(job.filePath, job.value);
      }
    }
  }

  if (options.check && changes.length > 0) {
    throw new Error(`Authoring v2 migration is not applied:\n- ${changes.join("\n- ")}`);
  }

  return { jobs, changes };
}

function runCli(argv = process.argv) {
  const result = run(parseArgs(argv));
  const verb = result.changes.length === 0 ? "checked" : "updated";
  console.log(`migrate-authoring-v2: ${verb} ${result.jobs.length} authoring files`);
  if (result.changes.length > 0) {
    for (const filePath of result.changes) {
      console.log(`- ${filePath}`);
    }
  }
  return result;
}

if (require.main === module) {
  try {
    runCli(process.argv);
  } catch (error) {
    console.error(`migrate-authoring-v2: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  collectMigrationJobs,
  run
};
