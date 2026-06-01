"use client";

/**
 * Client-only entry point for browser-heavy editor widgets.
 *
 * React Flow and Monaco both depend on browser layout APIs. Rendering the
 * workspace only on the client avoids hydration mismatches from SVG minimap
 * attributes and editor worker bootstrapping.
 */
import dynamic from "next/dynamic";

const EditorWorkspace = dynamic(
  () => import("@/components/editor-workspace").then((module) => module.EditorWorkspace),
  {
    ssr: false,
    loading: () => <div className="editor-loading">Loading editor...</div>
  }
);

export function ClientOnlyEditor() {
  return <EditorWorkspace />;
}
