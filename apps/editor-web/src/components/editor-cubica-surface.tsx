"use client";

/**
 * Bounded Cubica Surface renderer for the editor assistant sidebar.
 *
 * The component renders validated JSON Surface data only. It never accepts
 * React component instances, HTML strings or provider messages, so CopilotKit
 * remains an adapter and Cubica Surface stays the UI contract.
 */
import {
  validateCubicaSurface,
  type CubicaJsonValue,
  type CubicaSurface,
  type CubicaSurfaceAction,
  type CubicaSurfaceComponent
} from "@cubica/contracts-ai";
import React from "react";

export interface EditorCubicaSurfaceRendererProps {
  readonly surface: CubicaSurface;
  readonly onAction: (action: CubicaSurfaceAction) => void;
}

export function EditorCubicaSurfaceRenderer({ surface, onAction }: EditorCubicaSurfaceRendererProps) {
  const validation = validateCubicaSurface(surface, { targetChannel: "web" });

  return (
    <section className="editor-cubica-surface" aria-label={surface.title ?? "Cubica Surface"}>
      {surface.title !== undefined ? <h3>{surface.title}</h3> : null}
      {validation.diagnostics.length > 0 ? (
        <div className="editor-surface-diagnostics" role="status">
          {validation.diagnostics.map((diagnostic) => (
            <p key={`${diagnostic.code}-${diagnostic.pointer}`}>
              {diagnostic.code}: {diagnostic.message}
            </p>
          ))}
        </div>
      ) : null}
      {validation.ok ? renderComponent(surface.root, onAction) : null}
    </section>
  );
}

function renderComponent(component: CubicaSurfaceComponent, onAction: (action: CubicaSurfaceAction) => void): JSX.Element {
  const children = component.children?.map((child) => renderComponent(child, onAction));

  switch (component.kind) {
    case "cubica.text":
      return (
        <section className="editor-surface-block" key={component.id}>
          <p>{stringProp(component.props, "text") ?? stringProp(component.props, "body") ?? stringProp(component.props, "label")}</p>
          {children}
        </section>
      );
    case "cubica.button":
      return (
        <section className="editor-surface-actions" key={component.id}>
          {renderActions(component, onAction)}
          {children}
        </section>
      );
    case "cubica.diagnosticList":
      return (
        <section className="editor-surface-block editor-surface-block-warning" key={component.id}>
          <strong>{stringProp(component.props, "title") ?? "Diagnostics"}</strong>
          <ul>
            {stringListProp(component.props, "items").map((item, index) => (
              <li key={`${component.id}-diagnostic-${index}`}>{item}</li>
            ))}
          </ul>
          {children}
        </section>
      );
    case "cubica.diffSummary":
      return (
        <section className="editor-surface-block" key={component.id}>
          <strong>{stringProp(component.props, "title") ?? "Diff summary"}</strong>
          <ul>
            {stringListProp(component.props, "entries").map((entry, index) => (
              <li key={`${component.id}-diff-${index}`}>{entry}</li>
            ))}
          </ul>
          {children}
        </section>
      );
    case "cubica.approvalCard":
      return (
        <section className="editor-surface-approval" key={component.id}>
          <strong>{stringProp(component.props, "title") ?? "Approval"}</strong>
          <p>{stringProp(component.props, "summary")}</p>
          {children}
          {renderActions(component, onAction)}
        </section>
      );
    default:
      return (
        <section className="editor-surface-block editor-surface-block-warning" key={component.id}>
          <strong>Unsupported Surface component</strong>
          <p>{component.kind}</p>
        </section>
      );
  }
}

function renderActions(component: CubicaSurfaceComponent, onAction: (action: CubicaSurfaceAction) => void): JSX.Element | null {
  if (component.actions === undefined || component.actions.length === 0) {
    return null;
  }

  return (
    <div className="editor-surface-actions">
      {component.actions.map((action) => (
        <button
          type="button"
          key={action.id}
          onClick={() => onAction(action)}
          disabled={action.kind !== "editorTool" && action.kind !== "noop"}
        >
          {action.label ?? action.id}
        </button>
      ))}
    </div>
  );
}

function stringProp(props: Record<string, CubicaJsonValue>, key: string): string | undefined {
  const value = props[key];
  return typeof value === "string" ? value : undefined;
}

function stringListProp(props: Record<string, CubicaJsonValue>, key: string): readonly string[] {
  const value = props[key];

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }

      if (item !== null && typeof item === "object") {
        return stringProp(item as Record<string, CubicaJsonValue>, "message") ?? stringProp(item as Record<string, CubicaJsonValue>, "description");
      }

      return undefined;
    })
    .filter((item): item is string => item !== undefined);
}
