/**
 * Extracts the entry component key from the schema returned by the data loaders.
 * The current contract assumes an `application` root node whose first child acts as
 * the entry point rendered by the game screen.
 *
 * @param {Record<string, any>} jsonData - Parsed schema describing the full UI tree.
 * @returns {string | null} Key of the entry component, or null when missing.
 */

function findEntryPoint(jsonData) {
    const uiManifest = jsonData?.ui;
    if (uiManifest?.screens && typeof uiManifest.screens === 'object') {
        const explicitEntry = typeof uiManifest.entry_point === 'string' && uiManifest.entry_point.trim().length > 0
            ? uiManifest.entry_point.trim()
            : null;

        if (explicitEntry) {
            if (!Object.prototype.hasOwnProperty.call(uiManifest.screens, explicitEntry)) {
                console.error(`Entry point "${explicitEntry}" not found among UI manifest screens.`);
                return null;
            }
            return explicitEntry;
        }

        const screenKeys = Object.keys(uiManifest.screens);
        if (screenKeys.length === 0) {
            console.error('UI manifest does not contain any screens.');
            return null;
        }

        console.warn('Entry point not specified in UI manifest; falling back to the first screen.');
        return screenKeys[0];
    }

    const application = jsonData?.application;
    if (!application) {
        console.error('Application node missing from schema.');
        return null;
    }

    const elements = application.elements;
    if (!elements || typeof elements !== 'object') {
        console.error('Application element not found or does not contain child elements.');
        return null;
    }

    const explicitEntry = typeof application.entryPoint === 'string' && application.entryPoint.trim().length > 0
        ? application.entryPoint.trim()
        : typeof jsonData.entryPoint === 'string' && jsonData.entryPoint.trim().length > 0
            ? jsonData.entryPoint.trim()
            : null;

    if (explicitEntry) {
        if (!Object.prototype.hasOwnProperty.call(elements, explicitEntry)) {
            console.error(`Entry point "${explicitEntry}" not found among application elements.`);
            return null;
        }
        return explicitEntry;
    }

    const childKeys = Object.keys(elements);
    if (childKeys.length === 0) {
        console.error('Application element does not contain any child elements.');
        return null;
    }

    console.warn('Entry point not specified in schema; falling back to the first child element.');
    return childKeys[0];
}

export { findEntryPoint };
