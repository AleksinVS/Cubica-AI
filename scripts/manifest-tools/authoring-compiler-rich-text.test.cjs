/** Publication-side regression coverage for the shared rich-text whitelist. */
const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  CompileError,
  buildAjv,
  compileAuthoringText
} = require("./authoring-compiler.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");
const ajv = buildAjv();
const job = {
  kind: "ui",
  gameId: "neutral-rich-text",
  channel: "web",
  sourceFile: path.join(repoRoot, ".tmp", "neutral-rich-text.authoring.json"),
  outputFile: path.join(repoRoot, ".tmp", "neutral-rich-text.ui.manifest.json"),
  sourceMapFile: path.join(repoRoot, ".tmp", "neutral-rich-text.ui.manifest.source-map.json")
};

function authoringWithHtml(html) {
  return {
    _schemaVersion: "2.0",
    _manifestType: "ui",
    _channel: "web",
    _definitions: {},
    root: {
      _type: "ui.Manifest",
      _label: "Neutral rich text manifest",
      meta: {
        id: "neutral.rich.text.web",
        version: "1.0.0",
        game_id: "neutral-rich-text"
      },
      entry_point: "intro",
      screens: [{
        id: "intro",
        _type: "ui.Screen",
        _label: "Intro screen",
        title: "Intro",
        root: {
          _type: "ui.Component",
          _label: "Rich text",
          type: "richTextComponent",
          props: { html }
        }
      }]
    }
  };
}

test("publication accepts safe formatting from the shared whitelist", () => {
  const html = '<h1 class="heading">Heading</h1><p><strong>Safe</strong> <a href="https://example.test">link</a><sup>2</sup></p>';
  const output = compileAuthoringText(job, JSON.stringify(authoringWithHtml(html)), ajv);
  assert.equal(output.manifest.screens.intro.root.props.html, html);
});

test("publication preserves plain text and unresolved runtime expressions", () => {
  for (const html of ["Plain text", "{{currentItem.body}}"]) {
    const output = compileAuthoringText(job, JSON.stringify(authoringWithHtml(html)), ajv);
    assert.equal(output.manifest.screens.intro.root.props.html, html);
  }
});

for (const [label, html] of [
  ["script", "<p>Before</p><script>alert(1)</script>"],
  ["event handler", '<p onmouseover="alert(1)">Hover</p>'],
  ["executable URL", '<a href="javascript:alert(1)">Run</a>'],
  ["encoded executable URL", '<a href="java&#x73;cript:alert(1)">Run</a>']
]) {
  test(`publication rejects rich text with a ${label}`, () => {
    assert.throws(
      () => compileAuthoringText(job, JSON.stringify(authoringWithHtml(html)), ajv),
      (error) => {
        assert.ok(error instanceof CompileError);
        assert.match(error.rawMessage, /outside the platform whitelist/);
        return true;
      }
    );
  });
}
