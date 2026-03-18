/**
 * Утилиты для применения патчей (patch — описание изменений) к JSON-состоянию.
 *
 * В проекте используется базовый стандарт JSON Merge Patch (RFC 7396):
 * - патч — это частичный JSON-объект, который рекурсивно "накладывается" на текущее состояние;
 * - массивы заменяются целиком;
 * - `null` означает "удалить ключ" в целевом объекте.
 *
 * Дополнительно (опционально) поддерживается JSON Patch (RFC 6902) — набор операций с путями.
 *
 * ВНИМАНИЕ: ниже также сохранён `applyStateUpdates` — legacy-алгоритм "ключевых" обновлений
 * для UI-деревьев. Он НЕ является RFC 7396 и оставлен для обратной совместимости.
 */

export type ViewState = Record<string, unknown> | null;

const indexKeys = ["id", "key", "name"];

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Object.prototype.toString.call(value) === "[object Object]";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonMergePatch = JsonValue;

/**
 * Применить JSON Merge Patch (RFC 7396) к JSON-документу.
 *
 * Почему это важно:
 * - формат прост для генерации (в том числе LLM);
 * - хорошо подходит для API "отдать состояние целиком или отдать патч".
 *
 * Ограничения стандарта:
 * - если патч содержит массив, массив в целевом документе заменяется целиком (без merge по id).
 */
export function applyJsonMergePatch(target: JsonValue, patch: JsonMergePatch): JsonValue {
  if (patch === null) {
    return null;
  }

  if (Array.isArray(patch)) {
    return patch;
  }

  if (!isPlainObject(patch)) {
    return patch;
  }

  const targetObject = isPlainObject(target) ? (target as Record<string, JsonValue>) : {};
  const result: Record<string, JsonValue> = { ...targetObject };

  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete result[key];
      continue;
    }
    result[key] = applyJsonMergePatch(targetObject[key] as JsonValue, value as JsonValue);
  }

  return result;
}

export type JsonPatchOperation =
  | { op: "add"; path: string; value: JsonValue }
  | { op: "remove"; path: string }
  | { op: "replace"; path: string; value: JsonValue }
  | { op: "move"; from: string; path: string }
  | { op: "copy"; from: string; path: string }
  | { op: "test"; path: string; value: JsonValue };

const decodeJsonPointerSegment = (segment: string) => segment.replace(/~1/g, "/").replace(/~0/g, "~");

const parseJsonPointer = (pointer: string): string[] => {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) {
    throw new Error(`Invalid JSON Pointer: "${pointer}" (must start with "/")`);
  }
  return pointer
    .split("/")
    .slice(1)
    .map((segment) => decodeJsonPointerSegment(segment));
};

const cloneJson = (value: JsonValue): JsonValue => {
  // structuredClone — стандартный способ клонирования JSON-подобных структур в браузере/Node 18+.
  // Если он недоступен, используем JSON stringify/parse как запасной вариант.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const globalClone = (globalThis as any).structuredClone as ((input: unknown) => unknown) | undefined;
  if (typeof globalClone === "function") {
    return globalClone(value) as JsonValue;
  }
  return JSON.parse(JSON.stringify(value)) as JsonValue;
};

const getByPointer = (doc: JsonValue, pointer: string): JsonValue => {
  const segments = parseJsonPointer(pointer);
  let current: JsonValue = doc;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        throw new Error(`JSON Pointer "${pointer}" is out of bounds for array`);
      }
      current = current[index] as JsonValue;
      continue;
    }
    if (!isPlainObject(current)) {
      throw new Error(`JSON Pointer "${pointer}" does not match an object/array structure`);
    }
    if (!(segment in current)) {
      throw new Error(`JSON Pointer "${pointer}" points to a missing key "${segment}"`);
    }
    current = (current as Record<string, JsonValue>)[segment] as JsonValue;
  }
  return current;
};

const getParentByPointer = (doc: JsonValue, pointer: string): { parent: JsonValue; key: string } => {
  const segments = parseJsonPointer(pointer);
  if (!segments.length) {
    throw new Error(`JSON Pointer "${pointer}" points to the document root`);
  }
  const key = segments[segments.length - 1]!;
  const parentPointer = "/" + segments.slice(0, -1).map((s) => s.replace(/~/g, "~0").replace(/\//g, "~1")).join("/");
  const parent = segments.length === 1 ? doc : getByPointer(doc, parentPointer);
  return { parent, key };
};

const jsonEquals = (a: JsonValue, b: JsonValue) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Применить JSON Patch (RFC 6902) к JSON-документу.
 *
 * Примечание: формат оставлен как опциональный. Он точнее, но сложнее (особенно для генерации LLM),
 * поэтому для основного протокола рекомендуется JSON Merge Patch (RFC 7396).
 */
export function applyJsonPatch(target: JsonValue, operations: JsonPatchOperation[]): JsonValue {
  let doc = cloneJson(target);

  const setValue = (pointer: string, value: JsonValue, mode: "add" | "replace") => {
    const { parent, key } = getParentByPointer(doc, pointer);

    if (Array.isArray(parent)) {
      if (key === "-") {
        if (mode !== "add") {
          throw new Error(`JSON Patch "${mode}" does not support "-" index`);
        }
        parent.push(value);
        return;
      }
      const index = Number(key);
      if (!Number.isInteger(index) || index < 0 || index > parent.length) {
        throw new Error(`JSON Pointer "${pointer}" index is invalid for array`);
      }
      if (mode === "add") {
        parent.splice(index, 0, value);
      } else {
        if (index >= parent.length) {
          throw new Error(`JSON Pointer "${pointer}" is out of bounds for replace`);
        }
        parent[index] = value;
      }
      return;
    }

    if (!isPlainObject(parent)) {
      throw new Error(`JSON Pointer "${pointer}" parent is not an object/array`);
    }

    if (mode === "replace" && !(key in parent)) {
      throw new Error(`JSON Pointer "${pointer}" replace requires an existing key "${key}"`);
    }

    (parent as Record<string, JsonValue>)[key] = value;
  };

  const removeValue = (pointer: string) => {
    const { parent, key } = getParentByPointer(doc, pointer);

    if (Array.isArray(parent)) {
      const index = Number(key);
      if (!Number.isInteger(index) || index < 0 || index >= parent.length) {
        throw new Error(`JSON Pointer "${pointer}" is out of bounds for remove`);
      }
      parent.splice(index, 1);
      return;
    }

    if (!isPlainObject(parent)) {
      throw new Error(`JSON Pointer "${pointer}" parent is not an object/array`);
    }

    delete (parent as Record<string, JsonValue>)[key];
  };

  for (const operation of operations) {
    switch (operation.op) {
      case "add":
        setValue(operation.path, operation.value, "add");
        break;
      case "replace":
        setValue(operation.path, operation.value, "replace");
        break;
      case "remove":
        removeValue(operation.path);
        break;
      case "move": {
        const value = getByPointer(doc, operation.from);
        removeValue(operation.from);
        setValue(operation.path, value, "add");
        break;
      }
      case "copy": {
        const value = getByPointer(doc, operation.from);
        setValue(operation.path, cloneJson(value), "add");
        break;
      }
      case "test": {
        const actual = getByPointer(doc, operation.path);
        if (!jsonEquals(actual, operation.value)) {
          throw new Error(`JSON Patch test failed at "${operation.path}"`);
        }
        break;
      }
      default: {
        // Exhaustive check: если сюда попали, значит пришёл некорректный op.
        const op = (operation as { op: string }).op;
        throw new Error(`Unsupported JSON Patch operation: "${op}"`);
      }
    }
  }

  return doc;
}

const isMergeable = (value: unknown): value is Record<string, unknown> | unknown[] =>
  Array.isArray(value) || isPlainObject(value);

const getMatchingKey = (candidate: unknown, remainingKeys: Set<string>) => {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }
  for (const keyName of indexKeys) {
    const value = (candidate as Record<string, unknown>)[keyName];
    if (value != null && remainingKeys.has(String(value))) {
      return String(value);
    }
  }
  return null;
};

const getArrayItemKey = (item: unknown, fallback: number) => {
  if (item && typeof item === "object") {
    for (const keyName of indexKeys) {
      const value = (item as Record<string, unknown>)[keyName];
      if (value != null) {
        return String(value);
      }
    }
  }
  return String(fallback);
};

const mergeNodes = (target: unknown, patch: unknown): unknown => {
  if (patch === undefined) {
    return target;
  }

  if (Array.isArray(patch)) {
    const targetArray = Array.isArray(target) ? target : [];
    const next = targetArray.slice();
    const lookup = new Map<string, number>();

    targetArray.forEach((item, index) => {
      lookup.set(getArrayItemKey(item, index), index);
    });

    patch.forEach((patchItem, idx) => {
      const key = getArrayItemKey(patchItem, targetArray.length + idx);
      if (lookup.has(key)) {
        const matchIndex = lookup.get(key)!;
        next[matchIndex] = mergeNodes(targetArray[matchIndex], patchItem);
      } else {
        next.push(patchItem);
      }
    });

    return next;
  }

  if (isPlainObject(patch)) {
    const base = isPlainObject(target) ? target : {};
    let next: Record<string, unknown> = base;
    let mutated = false;

    Object.keys(patch).forEach((key) => {
      const patchedValue = mergeNodes((base as Record<string, unknown>)[key], (patch as Record<string, unknown>)[key]);
      if (patchedValue !== (base as Record<string, unknown>)[key]) {
        if (!mutated) {
          next = { ...base };
          mutated = true;
        }
        next[key] = patchedValue;
      }
    });

    return mutated ? next : base === target ? target : base;
  }

  return patch;
};

/**
 * Applies a patch payload to the current view state, keeping references stable when nodes are unchanged.
 * Unknown keys from the patch are appended to the root so that late-added nodes become part of the tree.
 */
export const applyStateUpdates = <TState extends ViewState>(tree: TState, updates: Record<string, unknown> = {}): TState => {
  if (!tree || !isPlainObject(updates)) {
    return tree;
  }

  const remainingKeys = new Set(Object.keys(updates));
  if (!remainingKeys.size) {
    return tree;
  }

  const walk = (node: unknown): unknown => {
    if (!isMergeable(node)) {
      return node;
    }

    if (Array.isArray(node)) {
      let mutated = false;
      const next = node.slice();

      for (let i = 0; i < node.length; i += 1) {
        const candidateKey = getMatchingKey(node[i], remainingKeys);
        let nextValue = node[i];

        if (candidateKey) {
          nextValue = mergeNodes(node[i], updates[candidateKey]);
          remainingKeys.delete(candidateKey);
        } else {
          nextValue = walk(node[i]);
        }

        if (nextValue !== node[i]) {
          next[i] = nextValue;
          mutated = true;
        }

        if (!remainingKeys.size) {
          break;
        }
      }

      return mutated ? next : node;
    }

    let mutated = false;
    let next: Record<string, unknown> | unknown = node;

    for (const key of Object.keys(node as Record<string, unknown>)) {
      let nextValue = (node as Record<string, unknown>)[key];

      if (remainingKeys.has(key)) {
        nextValue = mergeNodes((node as Record<string, unknown>)[key], updates[key]);
        remainingKeys.delete(key);
      } else {
        nextValue = walk((node as Record<string, unknown>)[key]);
      }

      if (nextValue !== (node as Record<string, unknown>)[key]) {
        if (!mutated) {
          next = { ...(node as Record<string, unknown>) };
          mutated = true;
        }
        (next as Record<string, unknown>)[key] = nextValue;
      }

      if (!remainingKeys.size) {
        break;
      }
    }

    return next;
  };

  let nextTree = walk(tree);

  if (remainingKeys.size) {
    const target = nextTree && nextTree !== tree ? nextTree : { ...(tree as Record<string, unknown>) };
    remainingKeys.forEach((key) => {
      (target as Record<string, unknown>)[key] = updates[key];
    });
    nextTree = target;
  }

  return nextTree as TState;
};
