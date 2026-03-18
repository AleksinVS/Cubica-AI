'use client';
import { createContext, useContext, useMemo } from 'react';
import { useViewState } from '@cubica/react-sdk';
import renderComponent from '../utils/renderer';
import { findEntryPoint } from '../utils/renderUtils';
import { createHybridDataSource } from '../sdk/dataSources';
import { createActionPresenter } from '../sdk/presenter';
import { loadLocalFixture } from '../utils/localDataLoader';

export const GameScreenContext = createContext({ state: null, status: 'idle', dispatchAction: () => { }, entryKey: null });

const GameScreenRenderer = ({ children, localDevelopment = false, localFixtureKey, routerConfig }) => {
    const dataSource = useMemo(
        () => createHybridDataSource({ localDevelopment, localFixtureKey, routerConfig }),
        [localDevelopment, localFixtureKey, routerConfig]
    );

    const { state, status, error, dispatchCommand, replaceState } = useViewState({
        sessionId: null,
        dataSource,
    });

    const dispatchAction = useMemo(
        () =>
            createActionPresenter({
                mode: localDevelopment ? 'local' : 'remote',
                replaceState,
                dispatchCommand,
                loadFixture: loadLocalFixture,
            }),
        [localDevelopment, replaceState, dispatchCommand]
    );

    if (status === 'loading') {
        return <div>Загрузка...</div>;
    }

    if (error) {
        return <div>{error}</div>;
    }

    if (!state) {
        return <div>Нет данных для отображения</div>;
    }

    const entryPointKey = findEntryPoint(state);
    const entryNode = entryPointKey && state?.ui?.screens
        ? state.ui.screens[entryPointKey]?.root ?? null
        : entryPointKey && state?.application?.elements
            ? { ...state.application.elements[entryPointKey], id: state.application.elements[entryPointKey].id ?? entryPointKey }
            : null;

    return (
        <GameScreenContext.Provider value={{ state, status, dispatchAction, entryKey: entryPointKey }}>
            <div>
                {entryNode ? renderComponent(entryNode, dispatchAction, state) : null}
                {children}
            </div>
        </GameScreenContext.Provider>
    );
};

export default GameScreenRenderer;

export const useGameScreenState = () => useContext(GameScreenContext);
