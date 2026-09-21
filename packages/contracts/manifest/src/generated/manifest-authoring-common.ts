/* eslint-disable */
/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Produced by scripts/manifest-tools/generate-contracts-types.cjs from the
 * canonical JSON Schema in docs/architecture/schemas/ (ADR-025, ADR-056).
 * JSON Schema is the single source of truth; regenerate with:
 *   npm run generate:contracts
 *
 * CI (scripts/ci/validate-contracts-schema-parity.js) fails if this file
 * drifts from the schema. Type/field changes must be made in the schema.
 */

/**
 * Semantic type name used by authoring instances. It explains the node intent and resolves through a local definition.
 *
 * This interface was referenced by `ManifestAuthoringCommonSchemaDefs`'s JSON-Schema
 * via the `definition` "semanticType".
 */
export type SemanticType = string;
/**
 * Stable ASCII-first identifier used for references, JSON Pointer mapping and generated runtime maps.
 *
 * This interface was referenced by `ManifestAuthoringCommonSchemaDefs`'s JSON-Schema
 * via the `definition` "entityId".
 */
export type EntityId = string;
/**
 * Human-readable editor name for a semantic entity. Cyrillic labels are allowed and expected for Russian authoring.
 *
 * This interface was referenced by `ManifestAuthoringCommonSchemaDefs`'s JSON-Schema
 * via the `definition` "editorLabel".
 */
export type EditorLabel = string;
/**
 * Plain-language explanation of what this entity means in game logic or UI.
 *
 * This interface was referenced by `ManifestAuthoringCommonSchemaDefs`'s JSON-Schema
 * via the `definition` "semanticDescription".
 */
export type SemanticDescription = string;
/**
 * Lifecycle state of a saved element prompt. Draft stores unconfirmed author input, normalized stores agent-prepared text awaiting confirmation, and confirmed is the target saved state.
 *
 * This interface was referenced by `ManifestAuthoringCommonSchemaDefs`'s JSON-Schema
 * via the `definition` "promptStatus".
 */
export type PromptStatus = "draft" | "normalized" | "confirmed";
/**
 * Origin of the saved prompt text.
 *
 * This interface was referenced by `ManifestAuthoringCommonSchemaDefs`'s JSON-Schema
 * via the `definition` "promptSource".
 */
export type PromptSource = "template" | "user" | "agent" | "imported" | "migration";
/**
 * BCP-47-like language tag used for the prompt text, for example ru or en-US.
 *
 * This interface was referenced by `ManifestAuthoringCommonSchemaDefs`'s JSON-Schema
 * via the `definition` "promptLanguage".
 */
export type PromptLanguage = string;
/**
 * UTC timestamp for authoring metadata. The schema uses a pattern instead of format so validation stays local and does not depend on optional Ajv format plugins.
 *
 * This interface was referenced by `ManifestAuthoringCommonSchemaDefs`'s JSON-Schema
 * via the `definition` "isoDateTimeString".
 */
export type IsoDateTimeString = string;
/**
 * Saved authoring-only prompt for one concrete game/UI entity. It captures author intent for content, behavior, state effects and methodology; it must not leak into generated runtime manifests.
 *
 * This interface was referenced by `ManifestAuthoringCommonSchemaDefs`'s JSON-Schema
 * via the `definition` "elementPrompt".
 */
export type ElementPrompt = {
  [k: string]: unknown;
} & {
  status: PromptStatus;
  /**
   * Original user text or text copied from a prototype prompt template.
   */
  raw: string;
  /**
   * Agent-structured wording that preserves the raw prompt meaning and can be shown to the user for confirmation.
   */
  normalized?: string;
  source: PromptSource;
  language: PromptLanguage;
  updatedAt: IsoDateTimeString;
};
/**
 * Authoring-only declaration that a game entity type/prototype REQUIRES a UI view (ADR-057 §4.2, §5; editor-preview-first-ux §2.1). `true` requires a view in every preview channel; the object form limits the requirement to the named channels. The editor raises the `entity-missing-view` diagnostic when a required view is absent in the active channel. This is authoring metadata: the compiler strips it and it never appears in runtime manifests.
 *
 * This interface was referenced by `ManifestAuthoringCommonSchemaDefs`'s JSON-Schema
 * via the `definition` "requiresView".
 */
export type RequiresView =
  | boolean
  | {
      /**
       * Preview channel keys (for example web, telegram) in which the entity requires a view.
       *
       * @minItems 1
       */
      channels: [string, ...string[]];
    };
/**
 * Authoring-only declaration that a UI element is decorative and carries no game meaning (ADR-057 §4.2, §5; editor-preview-first-ux §2.1). A decorative element needs no reference to a game entity and is excluded from the `entity-view-orphan` diagnostic. This is authoring metadata: the compiler strips it and it never appears in runtime manifests.
 *
 * This interface was referenced by `ManifestAuthoringCommonSchemaDefs`'s JSON-Schema
 * via the `definition` "decorativeFlag".
 */
export type DecorativeFlag = boolean;

export interface ManifestAuthoringCommonSchemaDefs {
  [k: string]: unknown;
}
/**
 * Authoring-only prompt template stored on reusable prototypes. Editors copy raw template text into a new instance _prompt.raw before the user edits and confirms it.
 *
 * This interface was referenced by `ManifestAuthoringCommonSchemaDefs`'s JSON-Schema
 * via the `definition` "promptTemplate".
 */
export interface PromptTemplate {
  /**
   * Prompt starter copied into a concrete element when the prototype is used.
   */
  raw: string;
  language: PromptLanguage;
  /**
   * Optional semantic type that this template is designed to create or refine.
   */
  appliesTo?: string;
}
/**
 * Authoring-only visible property of one prototype. Paths are JSON Pointers relative to the selected facet root; they do not grant write authority.
 *
 * This interface was referenced by `ManifestAuthoringCommonSchemaDefs`'s JSON-Schema
 * via the `definition` "projectionProperty".
 */
export interface ProjectionProperty {
  /**
   * Stable identity within this prototype family, preserved across inherited refinements.
   */
  id: string;
  facet: "logic" | "content" | "state" | "view" | "design" | "plugin";
  path: string;
  label?: string;
  description?: string;
  order?: number;
  group?: string;
  /**
   * @minItems 1
   */
  expose?: ["instance" | "prototype" | "details", ...("instance" | "prototype" | "details")[]];
  presentation: "text" | "quantity" | "choice" | "rule";
  /**
   * A declared nested or linked facet selected from proven editor context, never an arbitrary query.
   */
  reference?: {
    facet: "logic" | "content" | "state" | "view" | "design" | "plugin";
    path: string;
  };
}
/**
 * Authoring-only prototype property allowlist; child prototypes refine entries with the same id.
 *
 * This interface was referenced by `ManifestAuthoringCommonSchemaDefs`'s JSON-Schema
 * via the `definition` "projectionDescriptor".
 */
export interface ProjectionDescriptor {
  properties: ProjectionProperty[];
}
/**
 * Base metadata for a real authoring entity shown by the editor entity tree. The authoring JSON remains the source of truth; this metadata must not leak into generated runtime manifests.
 *
 * This interface was referenced by `ManifestAuthoringCommonSchemaDefs`'s JSON-Schema
 * via the `definition` "semanticEntity".
 */
export interface SemanticEntity {
  id?: EntityId;
  _type: SemanticType;
  _label: EditorLabel;
  _semantics?: SemanticDescription;
  _prompt?: ElementPrompt;
  _requiresView?: RequiresView;
  _decorative?: DecorativeFlag;
  [k: string]: unknown;
}
/**
 * Reusable authoring prototype. _semantics is required so people and agents can understand why this definition exists.
 *
 * This interface was referenced by `ManifestAuthoringCommonSchemaDefs`'s JSON-Schema
 * via the `definition` "authoringDefinition".
 *
 * This interface was referenced by `DefinitionsMap`'s JSON-Schema definition
 * via the `patternProperty` "^[a-z][a-zA-Z0-9]*(\.[A-Z][a-zA-Z0-9]*)+$".
 */
export interface AuthoringDefinition {
  /**
   * Semantic type name used by authoring instances. It explains the node intent and resolves through a local definition.
   */
  _extends?: string;
  _semantics: SemanticDescription;
  /**
   * Human-readable editor name for a semantic entity. Cyrillic labels are allowed and expected for Russian authoring.
   */
  _label?: string;
  _promptTemplate?: PromptTemplate;
  _projection?: ProjectionDescriptor;
  /**
   * Authoring-only declaration that a game entity type/prototype REQUIRES a UI view (ADR-057 §4.2, §5; editor-preview-first-ux §2.1). `true` requires a view in every preview channel; the object form limits the requirement to the named channels. The editor raises the `entity-missing-view` diagnostic when a required view is absent in the active channel. This is authoring metadata: the compiler strips it and it never appears in runtime manifests.
   */
  _requiresView?:
    | boolean
    | {
        /**
         * Preview channel keys (for example web, telegram) in which the entity requires a view.
         *
         * @minItems 1
         */
        channels: [string, ...string[]];
      };
  /**
   * Authoring-only declaration that a UI element is decorative and carries no game meaning (ADR-057 §4.2, §5; editor-preview-first-ux §2.1). A decorative element needs no reference to a game entity and is excluded from the `entity-view-orphan` diagnostic. This is authoring metadata: the compiler strips it and it never appears in runtime manifests.
   */
  _decorative?: boolean;
  [k: string]: unknown;
}
/**
 * Local registry of authoring definitions available to this manifest.
 *
 * This interface was referenced by `ManifestAuthoringCommonSchemaDefs`'s JSON-Schema
 * via the `definition` "definitionsMap".
 */
export interface DefinitionsMap {
  [k: string]: AuthoringDefinition;
}
/**
 * Companion file mapping generated runtime JSON Pointers back to authoring sources.
 *
 * This interface was referenced by `ManifestAuthoringCommonSchemaDefs`'s JSON-Schema
 * via the `definition` "sourceMap".
 */
export interface SourceMap {
  version: 1;
  generatedFile: string;
  sourceFile: string;
  mappings: {
    [k: string]: {
      file: string;
      pointer: string;
    }[];
  };
  /**
   * Sorted generated JSON Pointers whose entire subtree was omitted from `mappings` because it is a position-for-position verbatim copy of an ancestor's authoring subtree (see the authoring compiler's isPositionalMatch). A consumer that ignores this field still gets a correct, only less precise, answer by walking up to the nearest recorded ancestor as before; a consumer that reads it can append the remaining generated-pointer path to that ancestor's source pointer to recover the exact one. Optional so a source map produced before this field existed remains valid.
   */
  verbatimSubtrees?: string[];
}
