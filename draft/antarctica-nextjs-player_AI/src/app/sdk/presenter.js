export const actionTypes = {
    changeColor: "changeColor",
    showDescription: "showDescription",
    requestServer: "requestServer",
    showHistory: "showHistory",
    showHint: "showHint",
    showScreenLeft: "showScreenWithLeftSideBar",
    showTopBar: "showTopBar",
};

const fixtureByAction = {
    showScreenWithLeftSideBar: 'leftsidebar',
    showTopBar: 'main',
    showHint: 'hint',
    showHistory: 'journal',
};

/**
 * Создаёт диспетчер действий, который переводит события View в команды Presenter.
 */
export const createActionPresenter = ({ mode, replaceState, dispatchCommand, loadFixture }) => {
    return async (actionData, context) => {
        if (!actionData?.command) return;
        const actionName = actionData.command;

        if (actionName === actionTypes.changeColor || actionName === actionTypes.showDescription) {
            return;
        }

        if (mode === 'remote') {
            if (!dispatchCommand) {
                console.warn('Router недоступен: команда не отправлена.', actionName);
                return;
            }
            try {
                await dispatchCommand({
                    type: actionName,
                    payload: {
                        ...(actionData.payload || {}),
                        sourceId: context?.componentId,
                    },
                });
            } catch (err) {
                console.error('Ошибка отправки команды на Router:', err);
            }
            return;
        }

        if (actionName === actionTypes.requestServer) {
            return;
        }

        const requestedFixture = actionData.payload?.fixtureKey || fixtureByAction[actionName];
        if (requestedFixture && loadFixture) {
            const manifest = loadFixture(requestedFixture);
            replaceState(manifest);
        }
    };
};
