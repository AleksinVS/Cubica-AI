# ADR-010: JS Sandbox Security Strategy

- **Status**: Accepted
- **Date**: 2025-11-27
- **Author**: AI Agent
- **Context**: Feature F_00041, Epic E_0030

## 1. Context

Cubica's **Hybrid Execution Model** (ADR-007) allows game developers to write custom JavaScript logic for game actions (arithmetic, inventory management, navigation). This code runs on the Cubica Backend (Node.js).

**The Problem:** executing untrusted user code on the server poses severe security risks:
1.  **DoS Attacks:** Infinite loops or heavy computations blocking the event loop.
2.  **Memory Exhaustion:** Scripts allocating massive objects to crash the server.
3.  **Unauthorized Access:** Scripts trying to read env vars, file system, or make network requests.
4.  **Prototype Pollution:** Scripts modifying global prototypes to affect other games.

Standard Node.js `vm` module is **NOT** secure for untrusted code (see [Node.js Docs](https://nodejs.org/api/vm.html#vm_security)).

## 2. Decision

We will use **`isolated-vm`** as the sandboxing technology.

### 2.1. Technology Selection: `isolated-vm`
`isolated-vm` provides access to V8's `Isolate` interface.
- **True Isolation:** Each script runs in a separate V8 heap. No shared memory with the main process (unless explicitly transferred).
- **Resource Limits:** Supports strict limits on memory and CPU time.
- **Performance:** Faster than spawning child processes (like Deno) for every action.
- **Safety:** Used by major edge computing providers (Cloudflare Workers, Fly.io concept).

### 2.2. Security Policies (Quotas & Limits)

Every script execution is subject to the following hard limits:

| Parameter | Limit | Reason |
| :--- | :--- | :--- |
| **Execution Timeout (Wall)** | `100ms` | Prevent event loop blocking. Game logic must be instant. |
| **Memory Limit** | `128MB` | Generous for text games, but prevents heap overflow attacks. |
| **External Access** | `None` | No Network (fetch), No FS, No Process access. |
| **Language Features** | `Restricted` | No `eval()`, No `new Function()`, No `WASM` compilation (unless needed). |

### 2.3. API Surface (The Sandbox)
The script runs in a pristine environment. Only the following objects are injected:

1.  **`state` (Read-Write Copy):**
    - A deeply cloned copy of the current game state (`public` + `secret`).
    - *Mechanism:* `Copy-in` -> Script Modifies -> `Copy-out`.
    - *Why:* Prevents prototype poisoning of the main application state.

2.  **`args` (Read-Only):**
    - Input arguments for the action (e.g., item ID, target).

3.  **`std` (Read-Only Library):**
    - A set of safe, deterministic helper functions provided by the Engine.
    - `std.random`: Seedable PRNG (for replayability).
    - `std.math`: Safe math utilities.
    - `std.ui`: Helpers to generate UI effects (toasts, sounds).

### 2.4. Error Handling
- If a script exceeds limits (Timeout/Memory), the Isolate is disposed, and the execution fails with a specific error code (`ERR_SCRIPT_TIMEOUT`).
- The Game Engine must catch this error and return a safe fallback message to the user ("The game logic took too long to respond").

## 3. Consequences

### Positive
- **High Security:** V8 Isolates provide browser-grade security boundaries.
- **Stability:** One crashing script cannot crash the main Node.js process.
- **Determinism:** By controlling `Math.random` via `std` and enforcing synchronous execution, we facilitate replayability/testing.

### Negative
- **Deployment Complexity:** `isolated-vm` is a native C++ addon. It requires a build chain during deployment (`node-gyp`) and might be tricky on some serverless platforms (e.g., Vercel's standard lambdas might restrict native modules, though Docker containers work fine).
- **Data Marshalling Cost:** Copying state in/out takes CPU time. (Acceptable for expected state sizes < 100KB).

## 4. Alternatives Considered

- **Node.js `vm`:** Rejected. Known security holes (sandbox escape).
- **Deno (Subprocess):** Rejected. Process startup overhead (~50-100ms) is too high for high-frequency game actions.
- **QuickJS (WASM):** Good backup option if `isolated-vm` fails on target infrastructure, but slower execution speed.

## Scope and Exceptions

### User Scripts (Runtime Content Logic)
- **Applies:** Full sandbox isolation via isolated-vm
- **Source:** Game manifests, user-provided code
- **Trust level:** Untrusted
- **Restrictions:** Memory limits, timeout, no external access

### Engine Extensions (Build-time Capabilities)
- **Applies:** NO sandbox isolation
- **Source:** NPM packages, vetted by platform maintainers
- **Trust level:** Trusted (reviewed and signed)
- **Restrictions:** None (full Node.js API access)

> This ADR covers ONLY User Scripts. Engine Extensions are covered by ADR-015.
