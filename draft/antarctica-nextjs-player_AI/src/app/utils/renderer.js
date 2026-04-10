import React from 'react';
import {
    GameScreen,
    GameArea,
    GameVariable,
    GameCard,
    GameButton,
    JournalVariable,
    HelperComponent,
} from '@cubica/sdk-shared';

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const getByPath = (root, path) => {
    if (!root || typeof path !== 'string') {
        return undefined;
    }
    const parts = path.split('.').map((p) => p.trim()).filter(Boolean);
    let current = root;
    for (const part of parts) {
        if (!isPlainObject(current) && !Array.isArray(current)) {
            return undefined;
        }
        current = current?.[part];
        if (current === undefined) {
            return undefined;
        }
    }
    return current;
};

const TEMPLATE_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

const resolveTemplate = (value, context) => {
    if (typeof value !== 'string') {
        return value;
    }

    const exact = value.match(new RegExp(`^${TEMPLATE_RE.source}$`));
    if (exact) {
        return getByPath(context, exact[1]);
    }

    return value.replace(TEMPLATE_RE, (_, path) => {
        const resolved = getByPath(context, path);
        return resolved === undefined || resolved === null ? '' : String(resolved);
    });
};

const resolveDeep = (value, context) => {
    if (typeof value === 'string') {
        return resolveTemplate(value, context);
    }
    if (Array.isArray(value)) {
        return value.map((item) => resolveDeep(item, context));
    }
    if (isPlainObject(value)) {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveDeep(v, context)]));
    }
    return value;
};

const pickNodeType = (node) => node?.type ?? node?.component ?? null;
const pickNodeId = (node, fallbackId) => node?.id ?? fallbackId ?? null;

const renderNodeChildren = (node, onAction, viewModel) => {
    if (!node) return null;

    if (Array.isArray(node.children)) {
        return node.children.map((child, index) => {
            const fallbackId = node.id ? `${node.id}:${index}` : `node:${index}`;
            return renderComponent({ ...child, id: pickNodeId(child, fallbackId) }, onAction, viewModel);
        });
    }

    if (node.elements && typeof node.elements === 'object') {
        return Object.entries(node.elements).map(([key, value]) => {
            const withId = { ...value, id: pickNodeId(value, key) };
            return renderComponent(withId, onAction, viewModel);
        });
    }

    return null;
};

const renderFallbackComponent = ({ id, cssClass, nodeProps, nodeStyle, children }) => (
    <div id={id ?? undefined} className={cssClass} key={id ?? undefined} style={nodeStyle}>
        {children ?? nodeProps?.text ?? null}
    </div>
);

function renderComponent(componentData, onAction, viewModel) {
    if (!componentData) {
        return null;
    }

    const componentType = pickNodeType(componentData);
    const id = pickNodeId(componentData);

    const legacyProps = (() => {
        const { component, elements, cssClass, children, id: ignoredId, type, props, style, actions, ...rest } = componentData;
        return rest;
    })();

    const nodePropsRaw = isPlainObject(componentData.props) ? componentData.props : legacyProps;
    const nodeStyleRaw = componentData.style ?? nodePropsRaw.css ?? undefined;
    const nodeProps = resolveDeep(nodePropsRaw, viewModel);
    const nodeStyle = resolveDeep(nodeStyleRaw, viewModel);
    const actions = resolveDeep(componentData.actions ?? nodeProps.actions ?? undefined, viewModel);
    const cssClass = nodeProps.cssClass ?? componentData.cssClass ?? '';
    const cssInline = nodeProps.cssInline;
    const backgroundImage = nodeProps.backgroundImage ?? componentData.backgroundImage;

    if (componentType === 'screenComponent') {
        return (
            <GameScreen
                id={id ?? undefined}
                cssClass={cssClass}
                cssInline={cssInline}
                style={nodeStyle}
                backgroundImage={backgroundImage}
                key={id ?? undefined}
            >
                {renderNodeChildren(componentData, onAction, viewModel)}
            </GameScreen>
        );
    }

    if (componentType === 'areaComponent') {
        return (
            <GameArea
                id={id ?? undefined}
                cssClass={cssClass}
                style={nodeStyle}
                cssInline={cssInline}
                backgroundImage={backgroundImage}
                key={id ?? undefined}
            >
                {renderNodeChildren(componentData, onAction, viewModel)}
            </GameArea>
        );
    }

    if (componentType === 'gameVariableComponent') {
        return (
            <GameVariable
                id={id ?? undefined}
                cssClass={cssClass}
                cssInline={cssInline}
                style={nodeStyle}
                backgroundImage={backgroundImage}
                caption={nodeProps.caption}
                description={nodeProps.description}
                value={nodeProps.value}
                actions={actions}
                onAction={onAction}
                key={id ?? undefined}
            />
        );
    }

    if (componentType === 'journalVariableComponent') {
        return (
            <JournalVariable
                id={id ?? undefined}
                cssClass={cssClass}
                style={nodeStyle}
                cssInline={cssInline}
                caption={nodeProps.caption}
                value={nodeProps.value}
                previousValue={nodeProps.previousValue}
                key={id ?? undefined}
            />
        );
    }

    if (componentType === 'cardComponent') {
        return (
            <GameCard
                id={id ?? undefined}
                cssClass={cssClass}
                key={id ?? undefined}
                text={nodeProps.text}
                actions={actions}
                backgroundImage={backgroundImage}
                style={nodeStyle}
                cssInline={cssInline}
                onAction={onAction}
            >
                {renderNodeChildren(componentData, onAction, viewModel)}
            </GameCard>
        );
    }

    if (componentType === 'buttonComponent') {
        return (
            <GameButton
                id={id ?? undefined}
                cssClass={cssClass}
                style={nodeStyle}
                cssInline={cssInline}
                caption={nodeProps.caption}
                key={id ?? undefined}
                backgroundImage={backgroundImage}
                actions={actions}
                onAction={onAction}
            >
                {renderNodeChildren(componentData, onAction, viewModel)}
            </GameButton>
        );
    }

    if (componentType === 'helperComponent') {
        return (
            <HelperComponent
                id={id ?? undefined}
                cssClass={cssClass}
                text={nodeProps.text ?? nodeProps.caption}
                caption={nodeProps.caption}
                src={nodeProps.src}
                backgroundImage={backgroundImage}
                cssInline={cssInline}
                style={nodeStyle}
                alt={nodeProps.alt ?? nodeProps.caption ?? nodeProps.text ?? ''}
                key={id ?? undefined}
            />
        );
    }

    return renderFallbackComponent({
        id,
        cssClass,
        nodeProps,
        nodeStyle,
        children: renderNodeChildren(componentData, onAction, viewModel),
    });
}

export default function render(componentData, onAction, viewModel) {
    return renderComponent(componentData, onAction, viewModel);
}
