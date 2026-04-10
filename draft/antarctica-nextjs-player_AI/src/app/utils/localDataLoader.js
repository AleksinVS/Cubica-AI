import mainScreen from '../data/screen_s1.json';
import leftSidebarScreen from '../data/screen_leftsidebar.json';
import hintScreen from '../data/screen_hint.json';
import journalScreen from '../data/screen_j.json';
import antarcticaGameManifest from '../../../../antarctica/game.manifest.json';
import antarcticaWebUiManifest from '../../../../antarctica/ui/web/ui.manifest.json';

const DEFAULT_FIXTURE_KEY = 'main';

const fixtureCatalog = {
    main: {
        label: 'Основной экран',
        data: mainScreen,
    },
    leftsidebar: {
        label: 'Левый сайдбар',
        data: leftSidebarScreen,
    },
    hint: {
        label: 'Экран подсказки',
        data: hintScreen,
    },
    journal: {
        label: 'Журнал ходов',
        data: journalScreen,
    },
    antarctica: {
        label: 'Antarctica (манифест)',
        data: {
            game: antarcticaGameManifest,
            ui: antarcticaWebUiManifest,
        },
    },
};

const normalizeFixtureKey = (fixtureKey) => {
    if (typeof fixtureKey !== 'string') {
        return DEFAULT_FIXTURE_KEY;
    }
    const normalized = fixtureKey.trim().toLowerCase();
    return normalized.length > 0 ? normalized : DEFAULT_FIXTURE_KEY;
};

const cloneData = (data) => JSON.parse(JSON.stringify(data));

export const loadLocalFixture = (fixtureKey = DEFAULT_FIXTURE_KEY) => {
    const normalizedKey = normalizeFixtureKey(fixtureKey);
    const selectedFixture = fixtureCatalog[normalizedKey] ?? fixtureCatalog[DEFAULT_FIXTURE_KEY];
    return cloneData(selectedFixture.data);
};

export const listLocalFixtures = () =>
    Object.entries(fixtureCatalog).map(([key, meta]) => ({ key, label: meta.label }));
