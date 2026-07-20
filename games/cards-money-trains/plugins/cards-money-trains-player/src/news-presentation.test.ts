/** Focused tests for bounded, human-readable current-news feedback. */

import assert from "node:assert/strict";
import test from "node:test";

import { newsBannerLabel } from "./news-presentation.ts";

test("shows author number and normalized public text", () => {
  assert.equal(
    newsBannerLabel({
      id: "news-24",
      number: 24,
      text: "Компании  не платят\nза обслуживание."
    }, "news-24"),
    "Новость №24: Компании не платят за обслуживание."
  );
});

test("falls back to the stable id and bounds a long text", () => {
  assert.equal(newsBannerLabel(null, "news-unknown"), "Новость: news-unknown");
  const label = newsBannerLabel({
    id: "news-34",
    number: 34,
    text: "а".repeat(200)
  }, "news-34");
  assert.ok(label.startsWith("Новость №34: "));
  assert.ok(label.endsWith("…"));
  assert.ok(label.length < 130);
});
