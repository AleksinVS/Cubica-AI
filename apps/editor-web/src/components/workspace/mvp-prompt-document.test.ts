import { describe, expect, it } from "vitest";

import {
  MVP_PROMPT_SEPARATOR,
  parseMvpPromptDocument,
  serializeMvpPromptDocument,
  type MvpPromptSections
} from "./mvp-prompt-document";

describe("MVP prompt document", () => {
  it("uses exactly 23 equals signs and preserves empty sections", () => {
    expect(MVP_PROMPT_SEPARATOR).toHaveLength(23);
    const sections: MvpPromptSections = ["", "", ""];
    expect(parseMvpPromptDocument(serializeMvpPromptDocument(sections))).toEqual({ ok: true, sections });
  });

  it("round-trips three multiline sections and accepts CRLF input", () => {
    const sections: MvpPromptSections = ["Сделай кнопку крупнее\nИ синей", "Замысел\nВыбор", "label: Ответ\nstyle:\n  width: 220"];
    expect(parseMvpPromptDocument(serializeMvpPromptDocument(sections))).toEqual({ ok: true, sections });
    expect(parseMvpPromptDocument(serializeMvpPromptDocument(sections).replace(/\n/gu, "\r\n")))
      .toEqual({ ok: true, sections });
  });

  it("does not treat inline equals signs as section boundaries", () => {
    const sections: MvpPromptSections = [`Проверить x${MVP_PROMPT_SEPARATOR}y`, `Знак ${MVP_PROMPT_SEPARATOR} внутри строки`, "yaml: true"];
    expect(parseMvpPromptDocument(serializeMvpPromptDocument(sections))).toEqual({ ok: true, sections });
  });

  it("rejects missing, duplicate, and partial separator lines without returning truncated content", () => {
    for (const raw of [
      "Свободный текст без разделителей",
      `Первый\n${MVP_PROMPT_SEPARATOR}\nВторой`,
      `Первый\n${MVP_PROMPT_SEPARATOR}\nВторой\n${MVP_PROMPT_SEPARATOR}\nТретий\n${MVP_PROMPT_SEPARATOR}\nЧетвёртый`,
      `Первый\n ${MVP_PROMPT_SEPARATOR}\nВторой\n${MVP_PROMPT_SEPARATOR}\nТретий`
    ]) {
      const result = parseMvpPromptDocument(raw);
      expect(result.ok, raw).toBe(false);
      expect("sections" in result).toBe(false);
    }
  });

  it("reports the actual count when more than two separators would make the prompt roles ambiguous", () => {
    const raw = ["Правка", "Описание", "yaml: true", "Лишняя часть"].join(`\n${MVP_PROMPT_SEPARATOR}\n`);
    const result = parseMvpPromptDocument(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("Количество разделителей: 3; нужно 2");
      expect(result.message).toContain("Удалите лишние");
    }
    expect("sections" in result).toBe(false);
  });
});
