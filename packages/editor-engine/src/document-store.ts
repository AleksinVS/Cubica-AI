/**
 * Document store and JSON source-text location mapping.
 *
 * `createDocumentStore` wraps a single authoring file: it parses the text into
 * JSON, records syntax diagnostics, and exposes immutable snapshots while edits
 * go through JSON Patch. The text-location parser walks the raw JSON source to
 * map every JSON Pointer to its text range, so editors can place squiggles and
 * jump-to-source for diagnostics without a full AST library.
 */
import { makeDiagnostic } from "./shared.ts";
import { appendPointerSegment, applyJsonPatch, parseJsonPointer } from "./json-pointer-patch.ts";
import type {
  DocumentDiagnostic,
  DocumentSnapshot,
  DocumentStore,
  JsonValue,
  TextLocationEntry,
  TextLocationMap,
  TextPosition,
  TextRange
} from "./types.ts";

/** Creates a small mutable document store whose snapshots remain immutable values. */
export function createDocumentStore(input: { readonly filePath: string; readonly text: string }): DocumentStore {
  let text = input.text;
  let selectedPointer: string | undefined;
  let parsed = parseDocument(text);

  const makeSnapshot = (): DocumentSnapshot => ({
    filePath: input.filePath,
    text,
    json: parsed.json,
    diagnostics: parsed.diagnostics,
    selectedPointer,
    locationMap: parsed.locationMap
  });

  return {
    snapshot: makeSnapshot,
    applyPatch(operations) {
      if (parsed.json === undefined) {
        return makeSnapshot();
      }

      const nextJson = applyJsonPatch(parsed.json, operations);
      text = `${JSON.stringify(nextJson, null, 2)}\n`;
      parsed = parseDocument(text);
      return makeSnapshot();
    },
    selectPointer(pointer) {
      if (pointer !== undefined) {
        parseJsonPointer(pointer);
      }

      selectedPointer = pointer;
      return makeSnapshot();
    }
  };
}

function parseDocument(text: string): {
  readonly json: JsonValue | undefined;
  readonly diagnostics: readonly DocumentDiagnostic[];
  readonly locationMap: TextLocationMap;
} {
  try {
    const json = JSON.parse(text) as JsonValue;
    return {
      json,
      diagnostics: [],
      locationMap: buildTextLocationMap(text)
    };
  } catch (error) {
    const range = rangeFromJsonParseError(text, error);
    return {
      json: undefined,
      diagnostics: [
        makeDiagnostic({
          source: "syntax",
          pointer: "",
          message: error instanceof Error ? error.message : "Invalid JSON",
          range
        })
      ],
      locationMap: emptyLocationMap
    };
  }
}

function rangeFromJsonParseError(text: string, error: unknown): TextRange | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }

  const positionMatch = /\bposition\s+(\d+)\b/u.exec(error.message);
  if (positionMatch === null) {
    return undefined;
  }

  const offset = Number(positionMatch[1]);
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length) {
    return undefined;
  }

  const lineStarts = computeLineStarts(text);
  const start = positionForOffset(lineStarts, offset);
  const end = positionForOffset(lineStarts, Math.min(text.length, offset + 1));
  return { start, end };
}

function buildTextLocationMap(text: string): TextLocationMap {
  const parser = new JsonTextLocationParser(text);
  return parser.parse();
}

class JsonTextLocationParser {
  private readonly entriesByPointer = new Map<string, TextLocationEntry>();
  private readonly lineStarts: readonly number[];
  private index = 0;

  constructor(private readonly text: string) {
    this.lineStarts = computeLineStarts(text);
  }

  parse(): TextLocationMap {
    this.skipWhitespace();
    this.parseValue("", undefined);
    this.skipWhitespace();
    return createTextLocationMap(this.entriesByPointer);
  }

  private parseValue(pointer: string, key: TextRange | undefined): void {
    this.skipWhitespace();
    const start = this.index;
    const current = this.text[this.index];

    if (current === "{") {
      this.parseObject(pointer);
    } else if (current === "[") {
      this.parseArray(pointer);
    } else if (current === "\"") {
      this.parseStringToken();
    } else if (current === "-" || isDigit(current)) {
      this.parseNumberToken();
    } else if (this.text.startsWith("true", this.index)) {
      this.index += "true".length;
    } else if (this.text.startsWith("false", this.index)) {
      this.index += "false".length;
    } else if (this.text.startsWith("null", this.index)) {
      this.index += "null".length;
    } else {
      throw new Error(`Unexpected JSON token at offset ${this.index}.`);
    }

    this.entriesByPointer.set(pointer, {
      pointer,
      key,
      value: this.range(start, this.index)
    });
  }

  private parseObject(pointer: string): void {
    this.expect("{");
    this.skipWhitespace();

    if (this.peek() === "}") {
      this.index += 1;
      return;
    }

    while (this.index < this.text.length) {
      const keyToken = this.parseStringToken();
      this.skipWhitespace();
      this.expect(":");
      const childPointer = appendPointerSegment(pointer, keyToken.value);
      this.parseValue(childPointer, keyToken.range);
      this.skipWhitespace();

      if (this.peek() === "}") {
        this.index += 1;
        return;
      }

      this.expect(",");
      this.skipWhitespace();
    }

    throw new Error(`Unterminated object at offset ${this.index}.`);
  }

  private parseArray(pointer: string): void {
    this.expect("[");
    this.skipWhitespace();

    if (this.peek() === "]") {
      this.index += 1;
      return;
    }

    let itemIndex = 0;
    while (this.index < this.text.length) {
      this.parseValue(appendPointerSegment(pointer, String(itemIndex)), undefined);
      itemIndex += 1;
      this.skipWhitespace();

      if (this.peek() === "]") {
        this.index += 1;
        return;
      }

      this.expect(",");
      this.skipWhitespace();
    }

    throw new Error(`Unterminated array at offset ${this.index}.`);
  }

  private parseStringToken(): { readonly value: string; readonly range: TextRange } {
    const start = this.index;
    this.expect("\"");

    while (this.index < this.text.length) {
      const current = this.text[this.index];
      if (current === "\"") {
        this.index += 1;
        const raw = this.text.slice(start, this.index);
        return {
          value: JSON.parse(raw) as string,
          range: this.range(start, this.index)
        };
      }

      if (current === "\\") {
        this.index += 1;
        if (this.text[this.index] === "u") {
          this.index += 5;
        } else {
          this.index += 1;
        }
        continue;
      }

      this.index += 1;
    }

    throw new Error(`Unterminated string at offset ${start}.`);
  }

  private parseNumberToken(): void {
    const numberMatch = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(this.text.slice(this.index));
    if (numberMatch === null) {
      throw new Error(`Invalid number at offset ${this.index}.`);
    }

    this.index += numberMatch[0].length;
  }

  private skipWhitespace(): void {
    while (/\s/u.test(this.peek() ?? "")) {
      this.index += 1;
    }
  }

  private expect(expected: string): void {
    if (this.text[this.index] !== expected) {
      throw new Error(`Expected "${expected}" at offset ${this.index}.`);
    }

    this.index += 1;
  }

  private peek(): string | undefined {
    return this.text[this.index];
  }

  private range(start: number, end: number): TextRange {
    return {
      start: positionForOffset(this.lineStarts, start),
      end: positionForOffset(this.lineStarts, end)
    };
  }
}

/**
 * Rebuilds a {@link TextLocationMap} from a flat list of entries.
 *
 * This is the inverse of `TextLocationMap.entries()`: given the entries a
 * snapshot produced, it reconstructs a map that answers `get`/`getEntry`/
 * `entries` identically, WITHOUT re-parsing the source text. The disk warm-start
 * cache (see `document-snapshot-serialization.ts`) uses it to restore a cached
 * snapshot's location map, which is what makes a cache hit far cheaper than a
 * rebuild (building the location map is ~98% of the parse cost — profiling
 * baseline §9). Lookups are keyed by pointer, so the reconstructed map is
 * order-independent even though `entries()` re-sorts by text offset.
 */
export function createTextLocationMapFromEntries(entries: readonly TextLocationEntry[]): TextLocationMap {
  const byPointer = new Map<string, TextLocationEntry>();
  for (const entry of entries) {
    byPointer.set(entry.pointer, entry);
  }
  return createTextLocationMap(byPointer);
}

function createTextLocationMap(entries: ReadonlyMap<string, TextLocationEntry>): TextLocationMap {
  const copiedEntries = new Map(entries);
  const orderedEntries = [...copiedEntries.values()].sort((left, right) => left.value.start.offset - right.value.start.offset);

  return {
    get(pointer, target = "value") {
      const entry = copiedEntries.get(pointer);
      return target === "key" ? entry?.key : entry?.value;
    },
    getEntry(pointer) {
      return copiedEntries.get(pointer);
    },
    entries() {
      return orderedEntries;
    }
  };
}

function computeLineStarts(text: string): readonly number[] {
  const lineStarts = [0];

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      lineStarts.push(index + 1);
    }
  }

  return lineStarts;
}

function positionForOffset(lineStarts: readonly number[], offset: number): TextPosition {
  let low = 0;
  let high = lineStarts.length - 1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const lineStart = lineStarts[middle] as number;

    if (lineStart <= offset) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  const lineIndex = Math.max(0, high);
  const lineStart = lineStarts[lineIndex] as number;
  return {
    line: lineIndex + 1,
    column: offset - lineStart + 1,
    offset
  };
}

function isDigit(value: string | undefined): boolean {
  return value !== undefined && /^[0-9]$/u.test(value);
}

const emptyLocationMap: TextLocationMap = {
  get() {
    return undefined;
  },
  getEntry() {
    return undefined;
  },
  entries() {
    return [];
  }
};
