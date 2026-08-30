/** Browser-side regression coverage for the shared rich-text whitelist. */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { GameUiComponent, GameUiRichTextComponentProps } from "@cubica/contracts-manifest";

import { RichTextComponent } from "./rich-text-component";

function component(html: string): GameUiComponent<GameUiRichTextComponentProps> {
  return {
    type: "richTextComponent",
    props: { html }
  };
}

describe("RichTextComponent security policy", () => {
  it("removes scripts, event handlers and executable link schemes", () => {
    const { container } = render(
      <RichTextComponent
        component={component(
          '<p class="safe-copy" onclick="globalThis.__unsafe = true">' +
          '<strong>Safe text</strong><script>globalThis.__unsafe = true</script>' +
          '<a href="javascript:globalThis.__unsafe = true">Unsafe link</a></p>'
        )}
      />
    );

    const paragraph = container.querySelector("p");
    expect(paragraph?.className).toBe("safe-copy");
    expect(paragraph?.hasAttribute("onclick")).toBe(false);
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText("Unsafe link").getAttribute("href")).toBeNull();
  });

  it("preserves safe formatting, classes and web links", () => {
    const { container } = render(
      <RichTextComponent
        component={component(
          '<h2 class="heading">Heading</h2><p><em>Emphasis</em> and ' +
          '<a href="https://example.test/rules" title="Rules">a link</a><sup>2</sup></p>'
        )}
      />
    );

    expect(container.querySelector("h2.heading")?.textContent).toBe("Heading");
    expect(container.querySelector("em")?.textContent).toBe("Emphasis");
    expect(screen.getByText("a link").getAttribute("href")).toBe("https://example.test/rules");
    expect(container.querySelector("sup")?.textContent).toBe("2");
  });

  it("sanitizes markup introduced by a runtime expression", () => {
    const { container } = render(
      <RichTextComponent
        component={component("<p>{{payload}}</p>")}
        localContext={{ payload: '<img src="x" onerror="alert(1)"><em>Runtime text</em>' }}
      />
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("em")?.textContent).toBe("Runtime text");
  });
});
