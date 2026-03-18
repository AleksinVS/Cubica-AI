import { loadLocalFixture } from '../utils/localDataLoader';
import { fetchRouterState, sendRouterCommand } from '../utils/serverDataLoader';

/**
 * Источник данных, который в dev-режиме читает локальные фикстуры, а в боевом — Router.
 * Возвращает state/upates в формате, который понимает useViewState из @cubica/react-sdk.
 */
export const createHybridDataSource = ({ localDevelopment, localFixtureKey, routerConfig }) => {
    const routerOptions = routerConfig || { baseUrl: '/api', authToken: '', timeoutMs: 10000 };

    return {
        async loadInitial() {
            if (localDevelopment) {
                const manifest = loadLocalFixture(localFixtureKey);
                return { state: manifest };
            }
            if (localFixtureKey) {
                return sendRouterCommand(routerOptions, { type: 'StartGame', payload: { fixtureKey: localFixtureKey } });
            }
            return fetchRouterState(routerOptions);
        },
        async sendCommand(command) {
            if (localDevelopment) {
                return { updates: {} };
            }
            return sendRouterCommand(routerOptions, command);
        },
    };
};
