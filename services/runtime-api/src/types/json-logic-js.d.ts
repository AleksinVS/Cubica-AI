/**
 * Type declaration for json-logic-js.
 *
 * The package currently ships JavaScript without TypeScript declarations. The
 * runtime only needs the stable `apply` entry point, which evaluates a JsonLogic
 * rule against a data object and returns the computed value.
 */
declare module "json-logic-js" {
  const jsonLogic: {
    apply(rule: unknown, data?: unknown): unknown;
  };

  export default jsonLogic;
}
