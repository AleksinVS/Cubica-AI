/**
 * Helpers for portal launch route parsing.
 *
 * The canonical public URL is `/launch/:token::counter`, where `::` is the
 * literal separator between the token and link counter. The parser also accepts
 * `token:counter` as a defensive fallback for manually typed URLs.
 */

export function parseLaunchKey(launchKey) {
  const value = String(launchKey || "").trim();

  if (!value) {
    return { token: "", counter: "" };
  }

  const doubleColonIndex = value.lastIndexOf("::");

  if (doubleColonIndex > 0) {
    return {
      token: value.slice(0, doubleColonIndex),
      counter: value.slice(doubleColonIndex + 2),
    };
  }

  const singleColonIndex = value.lastIndexOf(":");

  if (singleColonIndex > 0) {
    return {
      token: value.slice(0, singleColonIndex),
      counter: value.slice(singleColonIndex + 1),
    };
  }

  return { token: value, counter: "" };
}
