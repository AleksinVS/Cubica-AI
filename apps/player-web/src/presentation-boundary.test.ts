/**
 * Regression checks for the platform/game visual boundary.
 *
 * These tests intentionally inspect the small set of source-of-truth files
 * involved in global presentation. A rendered DOM test alone would not catch
 * a game name or asset quietly returning to root metadata or global CSS.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const readRelativeToThisFile = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

describe("player presentation boundary", () => {
  it("keeps generic metadata and global styles free of Antarctica signals", () => {
    const rootLayout = readRelativeToThisFile("../app/layout.tsx");
    const globalStyles = readRelativeToThisFile("../app/globals.css");

    expect(rootLayout).not.toMatch(/antarctica/iu);
    expect(globalStyles).not.toMatch(/antarctica|arctic-background/iu);
    expect(globalStyles).toContain("var(--game-background-image, none)");
  });

  it("keeps simple-choice independent from the Antarctica background asset", () => {
    const runtimeUi = readRelativeToThisFile("../../../games/simple-choice/ui/web/ui.manifest.json");
    const authoringUi = readRelativeToThisFile("../../../games/simple-choice/authoring/ui/web.authoring.json");

    expect(runtimeUi).not.toMatch(/antarctica|arctic-background/iu);
    expect(authoringUi).not.toMatch(/antarctica|arctic-background/iu);
  });

  it("keeps the Antarctica background opt-in inside its game plugin", () => {
    const pluginConfig = readRelativeToThisFile(
      "../../../games/antarctica/plugins/antarctica-player/src/config-data.ts"
    );

    expect(pluginConfig).toContain('themeBackgroundImage: "/images/arctic-background.png"');
  });
});
