import { createRouterClient } from '@cubica/react-sdk';

const mapRouterPayload = (payload) => {
    if (!payload) {
        return { state: null };
    }
    if (payload.state) {
        return { state: payload.state, mergePatch: payload.mergePatch, updates: payload.updates, jsonPatch: payload.jsonPatch };
    }
    if (payload.application) {
        return { state: payload };
    }
    if (payload.mergePatch || payload.updates || payload.jsonPatch) {
        return { mergePatch: payload.mergePatch, updates: payload.updates, jsonPatch: payload.jsonPatch };
    }
    return { state: payload };
};

export const fetchRouterState = async (routerConfig) => {
    const client = await createRouterClient({
        routerBaseUrl: routerConfig.baseUrl,
        authToken: routerConfig.authToken,
        timeoutMs: routerConfig.timeoutMs,
    });
    const payload = await client.fetchState(null);
    return mapRouterPayload(payload);
};

export const sendRouterCommand = async (routerConfig, command) => {
    const client = await createRouterClient({
        routerBaseUrl: routerConfig.baseUrl,
        authToken: routerConfig.authToken,
        timeoutMs: routerConfig.timeoutMs,
    });
    const payload = await client.sendAction(null, command);
    return mapRouterPayload(payload);
};
