/** Shared whitelist used by UI-manifest publication and player rendering. */
export declare const RICH_TEXT_ALLOWED_TAGS: readonly string[];
export declare const RICH_TEXT_ALLOWED_ATTRIBUTES: Readonly<Record<string, readonly string[]>>;

/** Remove elements, attributes and URL schemes outside the shared safe subset. */
export declare function sanitizeManifestRichText(value: string): string;

/** True only when publication would preserve the authored fragment exactly. */
export declare function isManifestRichTextSafe(value: string): boolean;
