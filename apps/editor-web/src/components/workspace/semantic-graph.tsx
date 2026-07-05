/**
 * React Flow node and edge renderers for the editor's semantic graph surface.
 *
 * The graph is a derived projection of the authoring JSON: each node shows the
 * semantic role/title/summary of a manifest node and exposes an expand/collapse
 * toggle, while edges show the "contains"/"references" relationships between
 * them. These components are purely presentational — selection and expansion
 * state are owned by `EditorWorkspace` and passed through the node `data`.
 */
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  Handle,
  Position,
  type EdgeProps,
  type NodeProps
} from "@xyflow/react";
import { memo } from "react";

import type { SemanticFlowEdge, SemanticFlowNode } from "./types.ts";

/** Single semantic graph node card with role header and expand toggle. */
export const SemanticGraphNode = memo(function SemanticGraphNode({ data, selected }: NodeProps<SemanticFlowNode>) {
  return (
    <div className={`semantic-node semantic-node-${data.presentationRole} ${selected ? "is-selected" : ""}`}>
      <Handle type="target" position={Position.Left} className="semantic-node-handle" />
      <div className="semantic-node-header">
        <span className="semantic-node-role">{data.semanticRole}</span>
        {data.expandable ? (
          <button
            aria-label={data.expanded ? "Collapse branch" : "Expand branch"}
            className="semantic-node-toggle"
            data-node-action="toggle"
            title={data.expanded ? "Collapse branch" : "Expand branch"}
            type="button"
          >
            {data.expanded ? "-" : "+"}
          </button>
        ) : null}
      </div>
      <strong>{data.semanticTitle}</strong>
      <p>{data.semanticSummary}</p>
      <span className="semantic-node-meta">
        {data.valueType}
        {data.childCount > 0 ? ` · ${data.childCount} children` : ""}
      </span>
      <Handle type="source" position={Position.Right} className="semantic-node-handle" />
    </div>
  );
});

/** Smooth-step edge with an optional relationship label. */
export const SemanticGraphEdge = memo(function SemanticGraphEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data
}: EdgeProps<SemanticFlowEdge>) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition
  });
  const role = data?.role ?? "contains";

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} className={`semantic-edge semantic-edge-${role}`} />
      {data?.label ? (
        <EdgeLabelRenderer>
          <span className={`semantic-edge-label semantic-edge-label-${role}`} style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>
            {data.label}
          </span>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
});

/** React Flow node-type registry for the semantic graph. */
export const nodeTypes = {
  semantic: SemanticGraphNode
};

/** React Flow edge-type registry for the semantic graph. */
export const edgeTypes = {
  semantic: SemanticGraphEdge
};
