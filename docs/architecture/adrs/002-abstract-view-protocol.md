# ADR 002: Abstract View Protocol (Command Pattern + Promises)

## Status
Accepted

## Context
We are building a game architecture where the core logic (Presenter/Model) must be decoupled from the specific UI implementation (View). The same game logic might need to drive a sophisticated WebGL frontend, a simple DOM-based interface, or a text-based Telegram bot.

The View layer needs to translate abstract game concepts (e.g., "Unit Move") into concrete platform-specific actions (e.g., "Play slide animation for 2s" or "Send message 'Unit is moving...'").

We need a communication protocol that:
1. Decouples the Presenter from specific View methods.
2. Handles the asynchronous nature of UI actions (animations, transitions).
3. Allows for future extensibility (e.g., switching to Reactive Streams if needed) without rewriting the Presenter.

## Decision
We will implement an **Abstract View Layer** using the **Command Pattern** with **Promises**, exposed via a unified Gateway interface.

### 1. Unified Gateway Interface
The Presenter will communicate with the View exclusively through a single entry point: `dispatch(command)`.

```typescript
interface IViewGateway {
  dispatch(command: ViewCommand): Promise<ViewResponse>;
}
```

### 2. Command Pattern
All View actions are encapsulated in data objects (`ViewCommand`), not method calls.
- **Command**: `type` (string), `payload` (data).
- **Response**: `status` (completed/failed), `payload` (optional result).

### 3. Promises for Flow Control
- The `dispatch` method returns a `Promise` that resolves when the visual action is *semantically complete* (e.g., animation finished).
- This allows the Presenter to await complex visual sequences if necessary (e.g., in turn-based logic) or fire-and-forget for background actions.

### 4. Translation Layer (Manifests)
The View implementation is responsible for translating abstract commands (e.g., `MOVE_UNIT`) into concrete rendering logic. This mapping should ideally be driven by a Schema or Manifest, allowing behavior changes without code changes.

## Consequences

### Positive
- **Decoupling**: Presenter has zero knowledge of UI libraries (React, PixiJS, etc.).
- **Testability**: Presenter can be tested with a mock Gateway that just records commands.
- **Flexibility**: Different platforms (Web, Telegram) implement the same `IViewGateway` interface but handle commands differently.
- **Future-Proofing**: The `dispatch` method can internally wrap other paradigms (like RxJS streams) if we decide to change the implementation later, without breaking the Presenter's API.

### Negative
- **Verbosity**: Creating command objects is more verbose than direct method calls (`view.move(id, x, y)`).
- **State Sync**: Care must be taken to keep the View state synchronized with the Model, especially if animations are long-running. We mitigate this by sending absolute target states in commands where possible.

