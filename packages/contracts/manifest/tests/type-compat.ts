/**
 * Compile-time contract check for @cubica/contracts-manifest (ADR-056).
 *
 * This file is NOT a runtime test. It is compiled by `tsc --noEmit` (the
 * package `typecheck` script) to prove that the hand-written TypeScript contract
 * in `src/index.ts` structurally accepts the shape of the shipped manifest data.
 * If a manifest field used by a game diverged structurally from the contract
 * type (for example a required field the contract forgot to declare), this
 * assignment would fail to compile.
 *
 * Why the `WidenLiterals` view instead of a plain `const m: GameManifest = json`:
 * JSON module imports (`import ... with { type: "json" }`) widen every string
 * literal to `string` and every number literal to `number`. The contract, by
 * contrast, models several fields as string-literal enums or discriminated
 * unions (`kind: "computed"`, `executionMode`, object `visibility`, ...). A
 * direct assignment therefore fails purely because of that widening — NOT
 * because of real drift. The runtime AJV test (`manifests.test.ts`) already
 * proves the DATA honours those enums against the JSON Schema (the single source
 * of truth per ADR-025). Here we deliberately widen the contract's literals so
 * the compile check focuses on *structure* (shape, presence, nesting) without
 * re-litigating enum membership, which is AJV's job.
 *
 * Runtime schema validation of every discovered manifest lives in
 * `manifests.test.ts`; this file adds the structural type-side check over
 * representative shipped data. New games are covered by the runtime discovery
 * test.
 */
import type { GameManifest } from "../src/index.ts";

// Static imports so the compiler checks assignability against real data.
import antarcticaManifest from "../../../../games/antarctica/game.manifest.json" with { type: "json" };
import simpleChoiceManifest from "../../../../games/simple-choice/game.manifest.json" with { type: "json" };
import aiDrivenChoiceManifest from "../../../../games/ai-driven-choice/game.manifest.json" with { type: "json" };

/**
 * Recursively widen every literal type to its base primitive, preserving object
 * and array structure. This mirrors how a `with { type: "json" }` import is
 * typed, so shipped manifests remain assignable as long as they match the
 * contract *structurally*. Enum/discriminant conformance is validated at runtime
 * by AJV, not here.
 */
type WidenLiterals<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends boolean
      ? boolean
      : T extends ReadonlyArray<infer U>
        ? ReadonlyArray<WidenLiterals<U>>
        : T extends object
          ? { [K in keyof T]: WidenLiterals<T[K]> }
          : T;

// Each assignment is the compile-time assertion: the shipped manifest must be
// structurally assignable to the (literal-widened) GameManifest contract.
// `void` keeps the values referenced without emitting anything at runtime.
const antarctica: WidenLiterals<GameManifest> = antarcticaManifest;
const simpleChoice: WidenLiterals<GameManifest> = simpleChoiceManifest;
const aiDrivenChoice: WidenLiterals<GameManifest> = aiDrivenChoiceManifest;

void antarctica;
void simpleChoice;
void aiDrivenChoice;
