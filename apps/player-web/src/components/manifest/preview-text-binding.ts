import type { PlayerFacingContent } from "@cubica/contracts-manifest";
import { resolveExpressions } from "@/lib/expression-resolver";
import { readPreviewContentOrigin } from "@/lib/preview-content-origin";

export type PreviewTextProp = "html" | "caption" | "text" | "value";

export interface PreviewTextBinding {
  readonly prop: PreviewTextProp;
  readonly expression: string;
  readonly contentRuntimePointer?: string;
  readonly metricId?: string;
  readonly metricRuntimePointer?: string;
  readonly ruleRuntimePointer?: string;
}

/** The declared metric id identifies a definition, not a writable computed result. */
export function resolvePreviewMetricBinding(
  props: Record<string, unknown>,
  content: PlayerFacingContent
): PreviewTextBinding | undefined {
  const metricId = props.metricId;
  if (typeof metricId !== "string" || metricId.length === 0) return undefined;
  const valueExpression = typeof props.value === "string" ? props.value : `{{metrics.${metricId}}}`;
  if (typeof props.value === "string" &&
      props.value !== `{{metrics.${metricId}}}` &&
      props.value !== `{{game.state.public.metrics.${metricId}}}`) {
    return { prop: "value", expression: valueExpression };
  }
  const data = content.content?.data;
  const metrics = data && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>).metrics : undefined;
  if (!Array.isArray(metrics)) return undefined;
  const matches = metrics.flatMap((metric, index) =>
    metric !== null && typeof metric === "object" && !Array.isArray(metric) &&
      (metric as Record<string, unknown>).metricId === metricId ? [{ metric: metric as Record<string, unknown>, index }] : []);
  if (matches.length !== 1) return undefined;
  const { metric, index } = matches[0];
  const metricRuntimePointer = `/content/data/metrics/${index}`;
  const computed = metric.computed;
  const hasRule = computed !== null && typeof computed === "object" && !Array.isArray(computed) &&
    Object.hasOwn(computed, "expression");
  return {
    prop: "value",
    expression: valueExpression,
    metricId,
    metricRuntimePointer,
    ...(hasRule ? { ruleRuntimePointer: `${metricRuntimePointer}/computed/expression` } : {})
  };
}

export interface PreviewTextBindingInput {
  readonly props: Record<string, unknown>;
  readonly content: PlayerFacingContent;
  readonly gameState?: Record<string, unknown>;
  readonly localContext?: Record<string, unknown>;
}

export interface PreviewTextBindingEvidence {
  readonly textBinding?: PreviewTextBinding;
  /** The producer marked this object as the source of the exact displayed field. */
  readonly contentRuntimePointer?: string;
}

const textProps = ["html", "caption", "text", "value"] as const;
const directBinding = /^\{\{\s*([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*\}\}$/u;
const stableIdKey = /^(?:id|[A-Za-z][A-Za-z0-9]*Id)$/u;

/** A pointer is emitted only when the producer marked this exact projected object and field. */
export function resolvePreviewTextBinding(input: PreviewTextBindingInput): PreviewTextBinding | undefined {
  return resolvePreviewTextBindingEvidence(input).textBinding;
}

/** Keep the exact field pointer and its object owner from the same producer evidence. */
export function resolvePreviewTextBindingEvidence(input: PreviewTextBindingInput): PreviewTextBindingEvidence {
  const boundProps = textProps.filter((prop) => {
    const value = input.props[prop];
    return typeof value === "string" && value.length <= 512 && /\{\{[^{}]+\}\}/u.test(value);
  });
  if (boundProps.length !== 1) return {};

  const prop = boundProps[0];
  const expression = input.props[prop] as string;
  const match = directBinding.exec(expression);
  if (match === null) return { textBinding: { prop, expression } };

  const [, root, field] = match;
  if (stableIdKey.test(field)) return { textBinding: { prop, expression } };
  const local = ownRecord(input.localContext, root);
  const source = local !== undefined && local[field] !== undefined ? local : ownRecord(input.gameState, root);
  const origin = readPreviewContentOrigin(source);
  if (source === undefined || origin === undefined || !origin.fields.includes(field) ||
      typeof source[field] !== "string" ||
      resolveExpressions(expression, input.gameState ?? {}, input.localContext) !== source[field]) {
    return { textBinding: { prop, expression } };
  }

  return {
    textBinding: { prop, expression, contentRuntimePointer: origin.runtimePointer + "/" + escapePointer(field) },
    contentRuntimePointer: origin.runtimePointer
  };
}

function ownRecord(record: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  if (record === undefined || !Object.hasOwn(record, key)) return undefined;
  const value = record[key];
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function escapePointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
