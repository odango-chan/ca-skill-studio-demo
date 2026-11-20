// Node extension-host adapter for the same pinned Go/WASM Compiler used by the browser Worker.
import { parentPort, workerData } from "node:worker_threads";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

if (!parentPort) throw new Error("Compiler Node Worker requires a parentPort.");
globalThis.require ??= createRequire(import.meta.url);

const boot = (async () => {
  await import("./wasm_exec.js");
  if (typeof globalThis.Go !== "function") {
    throw new Error("Go WASM runtime did not expose the Go constructor.");
  }
  if (typeof workerData?.wasmPath !== "string" || !workerData.wasmPath) {
    throw new Error("Compiler Node Worker requires the staged skillc.wasm path.");
  }
  const bytes = await readFile(workerData.wasmPath);
  const go = new globalThis.Go();
  const instantiated = await WebAssembly.instantiate(bytes, go.importObject);
  void go.run(instantiated.instance);
  for (let attempt = 0; attempt < 100; attempt++) {
    if (typeof globalThis.skillcCheck === "function" &&
        typeof globalThis.skillcBuild === "function" &&
        typeof globalThis.skillcInspectDependencies === "function" &&
        typeof globalThis.skillcVerifyArtifact === "function") return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("Pinned Go/WASM Compiler did not expose its v1alpha5 callbacks.");
})();

parentPort.on("message", async message => {
  const { id, command, request } = message ?? {};
  try {
    if (!Number.isSafeInteger(id) || id < 1) {
      throw new Error("Invalid Compiler Worker request ID.");
    }
    await boot;
    if (!["check", "build", "inspect", "verifyArtifact"].includes(command)) {
      throw new Error("Unsupported Compiler Worker command.");
    }
    if (command === "verifyArtifact") {
      const result = String(globalThis.skillcVerifyArtifact(JSON.stringify(request)));
      parentPort.postMessage({ id, result });
      return;
    }
    const method = command === "check" ? globalThis.skillcCheck :
      command === "inspect" ? globalThis.skillcInspectDependencies : globalThis.skillcBuild;
    const result = JSON.parse(method(JSON.stringify(request)));
    parentPort.postMessage({ id, result });
  } catch (error) {
    parentPort.postMessage({ id, error: String(error?.message ?? error) });
  }
});
