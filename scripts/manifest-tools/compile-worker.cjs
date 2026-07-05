/**
 * Worker-thread entry point for parallel authoring compilation.
 *
 * WHY THIS EXISTS (profiling-baseline §9.6, owner requirement). Compilation
 * jobs are pure, independent functions of their authoring inputs, so they can
 * run on a pool of worker threads on a multi-core (production) host. This worker
 * does ONLY the pure compile: it never reads/writes the disk cache and never
 * writes runtime files. The main thread owns every side effect (cache I/O, file
 * writes, log lines) and applies them in job order, so parallel output stays
 * byte-identical to a sequential run.
 *
 * Each worker builds and reuses its OWN Ajv validators (per-worker cache, keyed
 * by schema hash) via getSharedAjv() — validators are not shared across threads.
 */

const { parentPort } = require("node:worker_threads");
const { compileAuthoringText, getSharedAjv } = require("./authoring-compiler.cjs");

parentPort.on("message", (message) => {
  if (message.type === "shutdown") {
    // Closing the port lets the worker's event loop drain and the thread exit.
    parentPort.close();
    return;
  }

  const { taskIndex, job, text } = message;
  try {
    const start = process.hrtime.bigint();
    const output = compileAuthoringText(job, text, getSharedAjv());
    const compileMs = Number(process.hrtime.bigint() - start) / 1e6;
    parentPort.postMessage({ taskIndex, ok: true, output, compileMs });
  } catch (error) {
    // CompileError carries filePath/pointer/rawMessage; forward them so the main
    // thread can rebuild an identical error message for the CLI.
    parentPort.postMessage({
      taskIndex,
      ok: false,
      error: {
        message: error.message,
        name: error.name,
        filePath: error.filePath,
        pointer: error.pointer,
        rawMessage: error.rawMessage
      }
    });
  }
});
