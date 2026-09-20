/** One visible draft with three sections, separated by two standalone lines. */
export type MvpPromptSections = readonly [string, string, string];

export const MVP_PROMPT_SEPARATOR = "=======================";

export type ParsedMvpPromptDocument =
  | { readonly ok: true; readonly sections: MvpPromptSections }
  | { readonly ok: false; readonly message: string };

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/gu, "\n");
}

export function serializeMvpPromptDocument(sections: MvpPromptSections): string {
  return sections.map(normalizeNewlines).join(`\n${MVP_PROMPT_SEPARATOR}\n`);
}

/** Parse only whole separator lines; a malformed draft remains untouched in the caller. */
export function parseMvpPromptDocument(text: string): ParsedMvpPromptDocument {
  const lines = normalizeNewlines(text).split("\n");
  const separators: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] === MVP_PROMPT_SEPARATOR) separators.push(index);
  }
  if (separators.length !== 2) {
    return { ok: false, message: `Нужны ровно две отдельные строки-разделителя «${MVP_PROMPT_SEPARATOR}».` };
  }
  return {
    ok: true,
    sections: [
      lines.slice(0, separators[0]).join("\n"),
      lines.slice(separators[0] + 1, separators[1]).join("\n"),
      lines.slice(separators[1] + 1).join("\n")
    ]
  };
}
