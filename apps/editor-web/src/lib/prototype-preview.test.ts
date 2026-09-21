import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compilePrototypeForEditor } from "./compiler-workflow";

describe("prototype preview compilation", () => {
  const gameId = "simple" + "-choice";
  const sourcePointer = "/root/screens/0/root/children/0";
  async function fixture() {
    const repoRoot = path.resolve(process.cwd(), "../..");
    const text = await readFile(path.join(repoRoot, "games", gameId, "authoring/ui/web.authoring.json"), "utf8");
    const json = JSON.parse(text);
    json._definitions = { "ui.Example": {
      _label: "Контейнер", _semantics: "Контейнер для проверки наследования.",
      type: "areaComponent", props: { cssClass: "prototype-default" }
    } };
    json.root.screens[0].root.children[0] = {
      _type: "ui.Example", _label: "Экземпляр", _semantics: "Локальный контейнер.",
      id: "example-instance", props: { cssClass: "instance-override" }
    };
    return { gameId, filePath: "ui/web.authoring.json", text: JSON.stringify(json),
      sourcePointer, prototypePointer: "/_definitions/ui.Example", repoRoot };
  }

  it("shows defaults, retains identity and leaves both authoring and published files untouched", async () => {
    const input = await fixture();
    const files = ["authoring/ui/web.authoring.json", "ui/web/ui.manifest.json"].map(file => path.join(input.repoRoot, "games", gameId, file));
    const before = await Promise.all(files.map(file => readFile(file, "utf8")));
    const component = await compilePrototypeForEditor(input);
    expect(component).toMatchObject({ id: "example-instance", type: "areaComponent", props: { cssClass: "prototype-default" } });
    expect(await Promise.all(files.map(file => readFile(file, "utf8")))).toEqual(before);
  }, 60_000);

  it("rejects a different prototype and paths outside the selected UI instance", async () => {
    const input = await fixture();
    await expect(compilePrototypeForEditor({ ...input, prototypePointer: "/_definitions/missing" })).rejects.toThrow("не принадлежит");
    await expect(compilePrototypeForEditor({ ...input, sourcePointer: input.prototypePointer })).rejects.toThrow("не принадлежит");
  });
});
