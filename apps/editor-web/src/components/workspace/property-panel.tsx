/**
 * Property inspector panel for the selected authoring node.
 *
 * `PropertyPanel` renders the editable fields of the currently selected node
 * ({@link PropertyField} per field) plus, for structural nodes, the
 * {@link GraphOperations} block (add/remove collection items, connect/disconnect
 * references). All edits are reported back to `EditorWorkspace` through
 * callbacks — this file never mutates the document itself. It uses the canonical
 * `isPlainJsonObject` from `@cubica/editor-engine` (no local copy).
 */
import { isPlainJsonObject, type JsonValue } from "@cubica/editor-engine";
import { useEffect, useState } from "react";

import {
  formatPropertyJson,
  isLocalReferenceValue,
  safeDefaultCollectionValue,
  type EditorProperty,
  type EditorViewNode,
  type RoutedEditorDiagnostic,
  type WritableGraphOperation
} from "@/lib/editor-web-adapter";

/** First non-root target pointer offered when connecting a reference field. */
function firstConnectableTargetPointer(nodes: readonly EditorViewNode[]): string {
  return nodes.find((node) => node.pointer !== "")?.pointer ?? nodes[0]?.pointer ?? "";
}

export function PropertyPanel({
  node,
  open,
  variant = "floating",
  selectedValue,
  properties,
  diagnostics,
  targetNodes,
  onChange,
  onJsonChange,
  onGraphOperation,
  onCollapse,
  onOpen,
  onReveal
}: {
  node: EditorViewNode | undefined;
  open: boolean;
  variant?: "floating" | "sidebar";
  selectedValue: JsonValue | undefined;
  properties: readonly EditorProperty[];
  diagnostics: readonly RoutedEditorDiagnostic[];
  targetNodes: readonly EditorViewNode[];
  onChange: (property: EditorProperty, rawValue: string) => void;
  onJsonChange: (property: EditorProperty, rawJson: string) => void;
  onGraphOperation: (operation: WritableGraphOperation) => void;
  onCollapse: () => void;
  onOpen: () => void;
  onReveal: (pointer: string) => void;
}) {
  const isCollection = Array.isArray(selectedValue) || isPlainJsonObject(selectedValue);
  const isReferenceField = typeof selectedValue === "string" || selectedValue === null;
  const defaultAddJson = formatPropertyJson(safeDefaultCollectionValue(selectedValue));

  if (!open) {
    if (variant === "sidebar") {
      return null;
    }

    return (
      <aside className="property-rail" aria-label="Selected node properties">
        <button type="button" onClick={onOpen}>
          <strong>Properties</strong>
          <span>{node?.semanticTitle ?? "No selection"}</span>
        </button>
      </aside>
    );
  }

  return (
    <div className={`property-panel ${variant === "sidebar" ? "property-panel-sidebar" : ""}`}>
      <div className="panel-heading">
        <strong>Properties</strong>
        <span>{node?.semanticRole ?? "No selection"}</span>
        <button type="button" onClick={onCollapse}>
          Collapse
        </button>
      </div>
      {node ? (
        <button className="selection-summary" type="button" onClick={() => onReveal(node.pointer)}>
          <span>{node.pointer || "/"}</span>
          <strong>{node.semanticTitle}</strong>
          <p>{node.semanticSummary}</p>
        </button>
      ) : null}
      <div className="property-list">
        {properties.length === 0 ? (
          <p className="empty-state">Select a JSON node with editable fields.</p>
        ) : (
          properties.map((property) => {
            const propertyDiagnostics = diagnostics.filter((diagnostic) => diagnostic.pointer === property.pointer);
            return (
              <PropertyField
                key={property.pointer}
                property={property}
                diagnostics={propertyDiagnostics}
                onChange={onChange}
                onJsonChange={onJsonChange}
                onReveal={onReveal}
              />
            );
          })
        )}
      </div>
      {node && node.role !== "property" ? (
        <GraphOperations
          node={node}
          selectedValue={selectedValue}
          isCollection={isCollection}
          isReferenceField={isReferenceField}
          defaultAddJson={defaultAddJson}
          targetNodes={targetNodes}
          onGraphOperation={onGraphOperation}
          onReveal={onReveal}
        />
      ) : null}
    </div>
  );
}

export function PropertyField({
  property,
  diagnostics,
  onChange,
  onJsonChange,
  onReveal
}: {
  property: EditorProperty;
  diagnostics: readonly RoutedEditorDiagnostic[];
  onChange: (property: EditorProperty, rawValue: string) => void;
  onJsonChange: (property: EditorProperty, rawJson: string) => void;
  onReveal: (pointer: string) => void;
}) {
  const [draftJson, setDraftJson] = useState(() => formatPropertyJson(property.value));

  useEffect(() => {
    setDraftJson(formatPropertyJson(property.value));
  }, [property.pointer, property.value]);

  const complexValue = property.valueType === "array" || property.valueType === "object" || property.valueType === "null";

  return (
    <label className="property-field">
      <span>{property.label}</span>
      {property.enumValues !== undefined && typeof property.value === "string" ? (
        <select
          value={property.value}
          disabled={!property.editable}
          onChange={(event) => onChange(property, event.target.value)}
        >
          {property.enumValues.map((option) => (
            <option value={option} key={option}>
              {option}
            </option>
          ))}
        </select>
      ) : property.valueType === "boolean" ? (
        <input
          type="checkbox"
          checked={property.value === true}
          disabled={!property.editable}
          onChange={(event) => onChange(property, event.target.checked ? "true" : "false")}
        />
      ) : property.valueType === "number" ? (
        <input
          type="number"
          value={String(property.value)}
          disabled={!property.editable}
          onChange={(event) => onChange(property, event.target.value)}
        />
      ) : complexValue ? (
        <div className="json-value-editor">
          <textarea
            value={draftJson}
            disabled={!property.editable}
            rows={Math.min(8, Math.max(3, draftJson.split("\n").length))}
            onChange={(event) => setDraftJson(event.target.value)}
          />
          <button type="button" disabled={!property.editable} onClick={() => onJsonChange(property, draftJson)}>
            Apply JSON
          </button>
        </div>
      ) : (
        <input
          value={String(property.value)}
          disabled={!property.editable}
          onChange={(event) => onChange(property, event.target.value)}
        />
      )}
      <button className="open-json-button" type="button" onClick={() => onReveal(property.pointer)}>
        Open in JSON
      </button>
      {diagnostics.map((diagnostic) => (
        <small className={`property-diagnostic property-diagnostic-${diagnostic.severity}`} key={diagnostic.message}>
          {diagnostic.source}: {diagnostic.message}
        </small>
      ))}
    </label>
  );
}

export function GraphOperations({
  node,
  selectedValue,
  isCollection,
  isReferenceField,
  defaultAddJson,
  targetNodes,
  onGraphOperation,
  onReveal
}: {
  node: EditorViewNode;
  selectedValue: JsonValue | undefined;
  isCollection: boolean;
  isReferenceField: boolean;
  defaultAddJson: string;
  targetNodes: readonly EditorViewNode[];
  onGraphOperation: (operation: WritableGraphOperation) => void;
  onReveal: (pointer: string) => void;
}) {
  const [itemKey, setItemKey] = useState("");
  const [itemJson, setItemJson] = useState(defaultAddJson);
  const [targetPointer, setTargetPointer] = useState(firstConnectableTargetPointer(targetNodes));

  useEffect(() => {
    setItemJson(defaultAddJson);
  }, [defaultAddJson, node.pointer]);

  useEffect(() => {
    setTargetPointer(firstConnectableTargetPointer(targetNodes));
  }, [targetNodes]);

  return (
    <section className="graph-operations" aria-label="Graph operations">
      <div className="panel-heading">
        <strong>Graph</strong>
        <button type="button" onClick={() => onReveal(node.pointer)}>
          Open in JSON
        </button>
      </div>

      {isCollection ? (
        <div className="graph-operation-block">
          <span>Add collection item</span>
          {isPlainJsonObject(selectedValue) ? (
            <input value={itemKey} placeholder="item key" onChange={(event) => setItemKey(event.target.value)} />
          ) : null}
          <textarea rows={4} value={itemJson} onChange={(event) => setItemJson(event.target.value)} />
          <button
            type="button"
            onClick={() =>
              onGraphOperation({
                type: "addCollectionItem",
                collectionPointer: node.pointer,
                key: itemKey,
                rawJson: itemJson
              })
            }
          >
            Add
          </button>
        </div>
      ) : null}

      {node.pointer !== "" ? (
        <button
          className="danger-button"
          type="button"
          onClick={() => onGraphOperation({ type: "removeCollectionItem", itemPointer: node.pointer })}
        >
          Remove selected
        </button>
      ) : null}

      {isReferenceField ? (
        <div className="graph-operation-block">
          <span>Reference</span>
          <select value={targetPointer} onChange={(event) => setTargetPointer(event.target.value)}>
            {targetNodes.map((target) => (
              <option value={target.pointer} key={target.id}>
                {target.pointer || "/"} · {target.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={targetPointer === ""}
            onClick={() =>
              onGraphOperation({
                type: "connectReference",
                referencePointer: node.pointer,
                targetPointer
              })
            }
          >
            Connect
          </button>
          {typeof selectedValue === "string" && isLocalReferenceValue(selectedValue) ? (
            <button
              type="button"
              onClick={() =>
                onGraphOperation({
                  type: "disconnectReference",
                  referencePointer: node.pointer
                })
              }
            >
              Disconnect
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
