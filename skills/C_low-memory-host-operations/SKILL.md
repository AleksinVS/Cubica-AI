---
name: low-memory-host-operations
description: Safely build, test, start, and recover Cubica services on a memory-constrained shared host. Use when running Next.js builds or E2E tests, starting player-web and editor-web together, investigating Failed to load chunk or unexplained SIGTERM failures, changing swap or earlyoom settings, cleaning up after tests, or operating on a host where browsers, AI agents, and Cubica compete for memory.
---

# Low-memory Host Operations

Keep Cubica available on a shared host without damaging unrelated user sessions
or hiding resource problems behind unsafe cache operations.

## Establish boundaries

1. Read the nearest `AGENTS.md` and
   `docs/processes/service-recovery-runbook.md` before changing commands or host
   settings.
2. Treat `necobox`, `necoray`, `vray`, unrelated browsers, terminals, and agent
   sessions as out of scope. Never stop or reconfigure them. If a process owner
   is unclear, inspect its parent, process group, start time, working directory,
   and port; leave it running unless ownership is proven.
3. Before a host-level change to swap, `earlyoom`, `systemd`, or `/etc`, require
   explicit user authorization. Repository builds and read-only diagnostics do
   not imply permission for these changes.
4. For Next.js configuration or command changes, use Context7 to confirm the
   installed version's supported options, then verify them against local types.

## Run the preflight gate

From the repository root, run:

```bash
skills/C_low-memory-host-operations/scripts/preflight.sh
```

Do not start a build when the gate reports another `next build`, less than
2 GiB available memory, missing swap, or less than 20% free swap. Wait for the
owned operation to finish or ask the user to close known unused applications.
Never resolve a failed gate by killing an unknown process.

## Choose the operating mode

- For stable cohabitation, build sequentially and run both web applications with
  `next start`.
- For active development, allow only one application in `next dev`; run the
  other from a production build with `next start`.
- Do not run two `next dev` instances or two builds on an 8 GiB GUI host.
- Build both applications only with:

  ```bash
  RUNTIME_API_URL=http://127.0.0.1:3001 npm run build:web:sequential
  ```

Parallel builds share `.next` as well as memory. An `ENOENT` for `*.nft.json`
usually indicates concurrent writers, not a missing source file.

## Diagnose before recovering

For `Failed to load chunk`, a disappearing development server, or an unexplained
`SIGTERM`:

1. Check whether the expected port is listening.
2. Inspect the owning process tree and Next.js log.
3. Inspect `journalctl -u earlyoom` for a matching termination time.
4. Capture `free -h`, `/proc/meminfo`, swap state, and the largest proportional
   process groups before changing anything.
5. Distinguish a dead server from stale browser chunks. Repair the server cause
   first; refresh the browser only after the server is healthy.

Do not delete `.next` as an automatic response. Remove it only after evidence of
corrupted build output and only when no other process uses that workspace.

## Clean up owned work

Make every test harness clean its own process group in `finally` or an equivalent
exit handler. On success, failure, interruption, and timeout:

1. Send `SIGTERM` to the test-owned process group.
2. Wait for a bounded interval.
3. Use `SIGKILL` only for survivors in that same confirmed group.
4. Verify owned ports are released and no owned Playwright, Next.js, runtime, or
   supervisor child remains.
5. Remove only the run's traces, snapshots, and logs under `.tmp/`.

Never use `drop_caches`, `swapoff -a`, blanket `pkill node`, automatic browser
termination, or cache-directory deletion as routine cleanup. Linux reclaims file
cache itself; these actions can create a new memory spike or destroy unrelated
work.

## Apply host protections

When the user explicitly authorizes host changes:

- Keep `earlyoom` enabled, but do not prefer generic `node`, `npm`, `python`, or
  `docker` names. Prefer only known disposable workers.
- Add `necobox`, `necoray`, and `vray` to the `earlyoom` avoidance expression.
- On an 8 GiB host, use 8 GiB total swap as an emergency buffer, not as a reason
  to parallelize builds.
- Apply swap with `swapon` and restart only `earlyoom`; do not reboot unless the
  user separately requests it.
- Preserve a rollback copy before changing `/etc`, validate the new service
  arguments, and confirm swap persistence in `/etc/fstab`.

## Verify completion

Before reporting success, collect fresh evidence that:

- `earlyoom` is active with the intended real command-line arguments;
- swap is active and persistent when it was changed;
- sequential production builds pass without another writer in the workspace;
- expected ports are healthy and stale owned ports are free;
- no low-memory termination occurred during verification;
- protected services were neither signaled nor reconfigured;
- `git diff --check` passes and temporary skill artifacts are removed.

If another terminal or agent starts a build during verification, stop only the
new operation you own, wait for the other writer, and repeat the affected check.
