/**
 * Shared safe subset for rich text carried by UI manifests.
 *
 * A whitelist is the explicit set of HTML elements and attributes that may
 * survive publication and rendering. Keeping both the policy and sanitizer in
 * this environment-neutral CommonJS module prevents the Node publication path
 * and browser renderer from drifting to different security rules.
 */
const sanitizeHtml = require("sanitize-html");

const RICH_TEXT_ALLOWED_TAGS = Object.freeze([
  "a",
  "b",
  "blockquote",
  "br",
  "code",
  "del",
  "div",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "i",
  "li",
  "mark",
  "ol",
  "p",
  "pre",
  "s",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "u",
  "ul"
]);

const RICH_TEXT_ALLOWED_ATTRIBUTES = Object.freeze({
  "*": Object.freeze(["class", "title"]),
  a: Object.freeze(["href"])
});

/**
 * Remove everything outside the platform-owned rich-text subset.
 *
 * Relative links and fragments remain valid. Absolute links are limited to
 * web and email destinations; executable and embedded-content schemes such as
 * `javascript:` and `data:` are never accepted.
 *
 * @param {string} value untrusted manifest or expression-resolved HTML
 * @returns {string} safe HTML fragment
 */
function sanitizeManifestRichText(value) {
  return sanitizeHtml(String(value), {
    allowedTags: RICH_TEXT_ALLOWED_TAGS,
    allowedAttributes: RICH_TEXT_ALLOWED_ATTRIBUTES,
    allowedSchemes: ["http", "https", "mailto"],
    allowProtocolRelative: false,
    parseStyleAttributes: false
  });
}

/** True only when publication would preserve the authored fragment exactly. */
function isManifestRichTextSafe(value) {
  return sanitizeManifestRichText(value) === value;
}

module.exports = {
  RICH_TEXT_ALLOWED_ATTRIBUTES,
  RICH_TEXT_ALLOWED_TAGS,
  isManifestRichTextSafe,
  sanitizeManifestRichText
};
