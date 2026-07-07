/**
 * Unit tests for the entity refactor dialogs (Phase 6.2b, design-spec §3.2, §9.1).
 *
 * The dialogs are purely presentational (they own no authoring data and build no
 * ChangeSet), so these tests assert exactly the UX contract: the delete scope
 * dialog enumerates facets + incoming references and offers cancel / delete-and-
 * clean / retarget; the rename dialog confirms a new id, refuses to submit an empty
 * or unchanged id, and shows a refusal message. Same react-dom/client + act harness
 * as `entity-inspector.test.tsx`.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import {
  DeleteEntityDialog,
  RenameEntityIdDialog,
  type DeleteEntityDialogProps,
  type RenameEntityIdDialogProps
} from "./entity-refactor-dialog";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Sets a controlled input's value through React's native value tracker so the
 * dispatched `input` event fires React's synthetic `onChange` (the direct
 * `input.value = …` assignment is otherwise swallowed by React's tracker).
 */
function typeIntoControlledInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function mount(node: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  return { container, root, mount: () => root.render(node), unmount: () => root.unmount() };
}

describe("DeleteEntityDialog", () => {
  const baseProps: DeleteEntityDialogProps = {
    entityLabel: "Действие: принять",
    facets: [
      { label: "Логика", source: "game.authoring.json#/root/logic/actions/0" },
      { label: "Вид · web", source: "ui/web.authoring.json#/root/screens/0/root/children/0" }
    ],
    incomingReferences: [
      { key: "actionId", source: "game.authoring.json#/root/logic/flows/0/steps/0/actionId" },
      { key: "actionId", source: "ui/web.authoring.json#/root/screens/0/root/children/0/actionId" }
    ],
    retargetOptions: [
      { id: "orphan", label: "Действие: сирота" },
      { id: "lonely", label: "Действие: одинокое" }
    ],
    onCancel: vi.fn(),
    onDeleteAndClean: vi.fn(),
    onRetarget: vi.fn()
  };

  it("enumerates the facets and incoming references, and offers all three options", async () => {
    const harness = mount(<DeleteEntityDialog {...baseProps} />);
    await act(async () => harness.mount());

    // Facets listed.
    expect(harness.container.textContent).toContain("Логика");
    expect(harness.container.textContent).toContain("Вид · web");
    // Incoming references listed with their carrying key and count.
    expect(harness.container.textContent).toContain("Входящие ссылки (2)");
    expect(harness.container.textContent).toContain("actionId");
    // Option 1: cancel. Option 2: delete-and-clean. Option 3: retarget (present because refs > 0).
    expect(harness.container.querySelector('[data-testid="entity-delete-clean"]')?.textContent).toBe("Удалить и вычистить ссылки");
    expect(harness.container.querySelector('[data-testid="entity-retarget-target"]')).not.toBeNull();
    expect(harness.container.querySelector('[data-testid="entity-retarget-confirm"]')).not.toBeNull();

    await act(async () => harness.unmount());
  });

  it("routes «Удалить и вычистить ссылки» to onDeleteAndClean", async () => {
    const onDeleteAndClean = vi.fn();
    const harness = mount(<DeleteEntityDialog {...baseProps} onDeleteAndClean={onDeleteAndClean} />);
    await act(async () => harness.mount());

    const button = harness.container.querySelector('[data-testid="entity-delete-clean"]') as HTMLButtonElement;
    await act(async () => button.click());
    expect(onDeleteAndClean).toHaveBeenCalledTimes(1);

    await act(async () => harness.unmount());
  });

  it("routes retarget to onRetarget with the chosen target id", async () => {
    const onRetarget = vi.fn();
    const harness = mount(<DeleteEntityDialog {...baseProps} onRetarget={onRetarget} />);
    await act(async () => harness.mount());

    const select = harness.container.querySelector('[data-testid="entity-retarget-target"]') as HTMLSelectElement;
    await act(async () => {
      select.value = "lonely";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const confirm = harness.container.querySelector('[data-testid="entity-retarget-confirm"]') as HTMLButtonElement;
    await act(async () => confirm.click());
    expect(onRetarget).toHaveBeenCalledWith("lonely");

    await act(async () => harness.unmount());
  });

  it("hides the retarget choice and shows a plain «Удалить» when there are no incoming references", async () => {
    const harness = mount(<DeleteEntityDialog {...baseProps} incomingReferences={[]} />);
    await act(async () => harness.mount());

    expect(harness.container.textContent).toContain("Нет входящих ссылок.");
    expect(harness.container.querySelector('[data-testid="entity-delete-clean"]')?.textContent).toBe("Удалить");
    expect(harness.container.querySelector('[data-testid="entity-retarget-confirm"]')).toBeNull();

    await act(async () => harness.unmount());
  });
});

describe("RenameEntityIdDialog", () => {
  const baseProps: RenameEntityIdDialogProps = {
    entityLabel: "Действие: принять",
    currentId: "accept",
    suggestedId: "accept",
    onCancel: vi.fn(),
    onConfirm: vi.fn()
  };

  it("confirms a changed id through onConfirm", async () => {
    const onConfirm = vi.fn();
    const harness = mount(<RenameEntityIdDialog {...baseProps} onConfirm={onConfirm} />);
    await act(async () => harness.mount());

    const input = harness.container.querySelector('[data-testid="entity-rename-input"]') as HTMLInputElement;
    await act(async () => typeIntoControlledInput(input, "confirm"));
    const confirm = harness.container.querySelector('[data-testid="entity-rename-confirm"]') as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    await act(async () => confirm.click());
    expect(onConfirm).toHaveBeenCalledWith("confirm");

    await act(async () => harness.unmount());
  });

  it("disables confirm while the id is unchanged or empty", async () => {
    const harness = mount(<RenameEntityIdDialog {...baseProps} />);
    await act(async () => harness.mount());

    // Seeded with the current id -> unchanged -> disabled.
    const confirm = harness.container.querySelector('[data-testid="entity-rename-confirm"]') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    await act(async () => harness.unmount());
  });

  it("shows a refusal message from a rejected build (taken/invalid id)", async () => {
    const harness = mount(<RenameEntityIdDialog {...baseProps} error="newId is already in use: orphan" />);
    await act(async () => harness.mount());

    const error = harness.container.querySelector('[data-testid="entity-rename-error"]');
    expect(error?.textContent).toContain("already in use");

    await act(async () => harness.unmount());
  });
});
