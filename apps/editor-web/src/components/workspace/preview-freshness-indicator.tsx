/**
 * Preview freshness marker for the status strip (editor-preview-first-ux §9.6,
 * mockup zone 7). Shows a colour-coded dot plus a plain-language Russian label
 * for the playthrough-axis freshness: актуален / отстаёт / заблокирован ошибками
 * / не подготовлен. The registry code (preview-stale / preview-blocked,
 * design-spec §4) is exposed as a data attribute for traceability.
 */
import React from "react";

import type { describePreviewFreshness } from "./workspace-helpers.ts";

export function PreviewFreshnessIndicator({
  descriptor
}: {
  readonly descriptor: ReturnType<typeof describePreviewFreshness>;
}) {
  return (
    <span
      className={`preview-freshness preview-freshness-${descriptor.tone}`}
      data-diagnostic-code={descriptor.code}
    >
      <span className="preview-freshness-dot" />
      {descriptor.label}
    </span>
  );
}
