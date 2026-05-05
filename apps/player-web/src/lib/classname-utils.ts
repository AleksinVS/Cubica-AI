/**
 * Идемпотентная конкатенация CSS-классов.
 */
export function appendClassName(existing: string | undefined, className: string): string {
  const classes = new Set((existing ?? "").split(/\s+/).filter(Boolean));
  classes.add(className);
  return Array.from(classes).join(" ");
}
