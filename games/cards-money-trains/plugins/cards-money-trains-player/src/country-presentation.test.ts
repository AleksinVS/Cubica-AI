/** Focused tests for bounded country content and map-click priority. */

import assert from "node:assert/strict";
import test from "node:test";

import {
  countryAtOffset,
  readCountryCatalogue,
  resolveNodePointerIntent
} from "./country-presentation.ts";

test("sanitizes and freezes at most ten complete country records", () => {
  const records = Array.from({ length: 12 }, (_, index) => ({
    id: `country-${index + 1}`,
    title: `Страна ${index + 1}`,
    description: `Описание ${index + 1}`,
    terminalIds: ["secretly-irrelevant-to-presentation"]
  }));
  records.splice(2, 0, {
    id: "INVALID ID",
    title: "Недопустимая запись",
    description: "Не должна попасть в интерфейс",
    terminalIds: []
  });
  records[4] = {
    id: "country-1",
    title: "Дубликат",
    description: "Не должен заменить первую запись",
    terminalIds: []
  };

  const result = readCountryCatalogue({ countries: records });

  // Work is bounded by the first ten source entries; invalid entries do not
  // cause the sanitizer to continue scanning an unbounded array.
  assert.deepEqual(
    result.map((country) => country.id),
    [
      "country-1",
      "country-2",
      "country-3",
      "country-5",
      "country-6",
      "country-7",
      "country-8",
      "country-9"
    ]
  );
  assert.equal(Object.isFrozen(result), true);
  assert.equal(result.every(Object.isFrozen), true);
  assert.deepEqual(Object.keys(result[0] ?? {}), ["id", "title", "description"]);
});

test("rejects missing, oversized, and non-string catalogue fields", () => {
  const result = readCountryCatalogue({
    countries: [
      { id: "missing-description", title: "Нет описания" },
      { id: "bad-title", title: 42, description: "Описание" },
      {
        id: "oversized-description",
        title: "Слишком длинное описание",
        description: "x".repeat(4_001)
      },
      {
        id: "valid-country",
        title: "  Валидная страна  ",
        description: "  Валидное описание  "
      }
    ]
  });

  assert.deepEqual(result, [{
    id: "valid-country",
    title: "Валидная страна",
    description: "Валидное описание"
  }]);
  assert.deepEqual(readCountryCatalogue(null), []);
  assert.deepEqual(readCountryCatalogue({ countries: "not-an-array" }), []);
});

test("keeps construction and server actions ahead of country information", () => {
  assert.equal(resolveNodePointerIntent({
    canSelectRoad: true,
    hasServerHighlightAction: true,
    hasCountryInformation: true
  }), "road-selection");
  assert.equal(resolveNodePointerIntent({
    canSelectRoad: false,
    hasServerHighlightAction: true,
    hasCountryInformation: true
  }), "server-highlight");
  assert.equal(resolveNodePointerIntent({
    canSelectRoad: false,
    hasServerHighlightAction: false,
    hasCountryInformation: true
  }), "country-information");
  assert.equal(resolveNodePointerIntent({
    canSelectRoad: false,
    hasServerHighlightAction: false,
    hasCountryInformation: false
  }), "none");
});

test("navigates the complete bounded catalogue independently from terminal geometry", () => {
  const countries = readCountryCatalogue({
    countries: [
      { id: "proud", title: "Гордая", description: "Без терминалов" },
      { id: "north", title: "Северная", description: "С терминалами" },
      { id: "white", title: "Белая", description: "С терминалами" }
    ]
  });

  assert.equal(countryAtOffset(countries, null, 0)?.id, "proud");
  assert.equal(countryAtOffset(countries, "proud", 1)?.id, "north");
  assert.equal(countryAtOffset(countries, "proud", -1)?.id, "white");
  assert.equal(countryAtOffset(countries, "missing", 0)?.id, "proud");
  assert.equal(countryAtOffset([], null, 1), null);
  assert.equal(countryAtOffset(countries, "proud", 0.5), null);
});
