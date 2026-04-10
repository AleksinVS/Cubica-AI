/**
 * Скрипт синхронизации манифестов игры Antarctica.
 *
 * Цель: Обеспечить Single Source of Truth (единый источник истины) для манифестов.
 * Источник: games/antarctica/ (game.manifest.json и ui/web/ui.manifest.json)
 * Назначение: games/antarctica-nextjs-player/src/app/data/synced/
 *
 * Этот скрипт выполняется автоматически перед `npm run dev` и `npm run build`
 * через npm-хуки prebuild и predev.
 *
 * Примечание: Плеер также использует прямые ES-импорты из источника
 * (см. localDataLoader.js), но этот скрипт обеспечивает дополнительную
 * явную синхронизацию и логирование для прозрачности процесса сборки.
 */

const fs = require('fs');
const path = require('path');

// === Конфигурация путей ===

/**
 * Корневая директория плеера Antarctica (текущий проект).
 */
const PLAYER_ROOT = path.resolve(__dirname, '..');

/**
 * Корневая директория игры Antarctica (источник истины).
 */
const GAME_ROOT = path.resolve(PLAYER_ROOT, '..', 'antarctica');

/**
 * Директория для синхронизированных манифестов в плеере.
 */
const SYNCED_DIR = path.resolve(PLAYER_ROOT, 'src', 'app', 'data', 'synced');

/**
 * Определение файлов для синхронизации.
 * Каждый элемент содержит:
 *   - source: относительный путь от GAME_ROOT
 *   - dest: имя файла в SYNCED_DIR
 *   - description: описание для логирования
 */
const MANIFEST_FILES = [
  {
    source: 'game.manifest.json',
    dest: 'game.manifest.json',
    description: 'Игровой манифест (meta, config, state, actions)',
  },
  {
    source: path.join('ui', 'web', 'ui.manifest.json'),
    dest: 'ui.manifest.json',
    description: 'UI-манифест для веб-платформы (screens, layouts)',
  },
];

// === Вспомогательные функции ===

/**
 * Форматирует дату/время для логов.
 * @returns {string} Строка с текущим временем в формате ISO.
 */
const timestamp = () => new Date().toISOString();

/**
 * Логирует сообщение с префиксом [sync-manifest].
 * @param {string} message - Сообщение для вывода.
 */
const log = (message) => {
  console.log(`[sync-manifest] ${message}`);
};

/**
 * Логирует ошибку с префиксом [sync-manifest ERROR].
 * @param {string} message - Сообщение об ошибке.
 */
const logError = (message) => {
  console.error(`[sync-manifest ERROR] ${message}`);
};

/**
 * Создает директорию, если она не существует.
 * @param {string} dirPath - Путь к директории.
 */
const ensureDir = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    log(`Создана директория: ${dirPath}`);
  }
};

/**
 * Копирует файл из источника в назначение.
 * @param {string} sourcePath - Абсолютный путь к исходному файлу.
 * @param {string} destPath - Абсолютный путь к файлу назначения.
 * @returns {boolean} true если копирование успешно, false при ошибке.
 */
const copyFile = (sourcePath, destPath) => {
  try {
    if (!fs.existsSync(sourcePath)) {
      logError(`Файл источника не найден: ${sourcePath}`);
      return false;
    }

    const content = fs.readFileSync(sourcePath, 'utf-8');
    fs.writeFileSync(destPath, content, 'utf-8');
    return true;
  } catch (error) {
    logError(`Ошибка копирования ${sourcePath} -> ${destPath}: ${error.message}`);
    return false;
  }
};

/**
 * Проверяет, изменился ли файл (сравнивает содержимое).
 * @param {string} sourcePath - Путь к исходному файлу.
 * @param {string} destPath - Путь к файлу назначения.
 * @returns {boolean} true если файлы различаются или dest не существует.
 */
const hasFileChanged = (sourcePath, destPath) => {
  if (!fs.existsSync(destPath)) {
    return true;
  }

  try {
    const sourceContent = fs.readFileSync(sourcePath, 'utf-8');
    const destContent = fs.readFileSync(destPath, 'utf-8');
    return sourceContent !== destContent;
  } catch {
    return true;
  }
};

// === Основная логика ===

/**
 * Выполняет синхронизацию всех манифестов.
 */
const syncManifests = () => {
  log(`=== Синхронизация манифестов [${timestamp()}] ===`);
  log(`Источник: ${GAME_ROOT}`);
  log(`Назначение: ${SYNCED_DIR}`);

  // Проверка существования источника
  if (!fs.existsSync(GAME_ROOT)) {
    logError(`Директория источника не найдена: ${GAME_ROOT}`);
    process.exit(1);
  }

  // Создание директории назначения
  ensureDir(SYNCED_DIR);

  // Статистика синхронизации
  let synced = 0;
  let unchanged = 0;
  let errors = 0;

  // Синхронизация каждого файла
  for (const manifest of MANIFEST_FILES) {
    const sourcePath = path.join(GAME_ROOT, manifest.source);
    const destPath = path.join(SYNCED_DIR, manifest.dest);

    log(`--- ${manifest.description} ---`);

    if (!hasFileChanged(sourcePath, destPath)) {
      log(`  [SKIP] ${manifest.dest} - без изменений`);
      unchanged++;
      continue;
    }

    if (copyFile(sourcePath, destPath)) {
      log(`  [OK] ${manifest.source} -> ${manifest.dest}`);
      synced++;
    } else {
      errors++;
    }
  }

  // Итоговый отчет
  log('');
  log('=== Результат синхронизации ===');
  log(`  Синхронизировано: ${synced}`);
  log(`  Без изменений: ${unchanged}`);
  log(`  Ошибок: ${errors}`);

  if (errors > 0) {
    logError('Синхронизация завершена с ошибками!');
    process.exit(1);
  }

  log('Синхронизация успешно завершена.');
};

// === Точка входа ===

syncManifests();
