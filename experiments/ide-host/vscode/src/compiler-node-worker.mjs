// Node extension-host adapter for the same released Compiler v2.1.0 WASM used by the browser Worker.
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
        typeof globalThis.skillcVerifyArtifact === "function" &&
        typeof globalThis.skillcBuildDevelopment === "function" &&
        typeof globalThis.skillcVerifyDevelopment === "function") return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("Pinned Go/WASM Compiler v2.1.0 did not expose its frozen and Development callbacks.");
})();
void boot.catch(() => undefined);

parentPort.on("message", async message => {
  const { id, command, request } = message ?? {};
  try {
    if (!Number.isSafeInteger(id) || id < 1) {
      throw new Error("Invalid Compiler Worker request ID.");
    }
    await boot;
    if (!["check", "build", "inspect", "verifyArtifact", "buildDevelopment", "verifyDevelopment"].includes(command)) {
      throw new Error("Unsupported Compiler Worker command.");
    }
    if (command === "verifyArtifact") {
      const result = String(globalThis.skillcVerifyArtifact(JSON.stringify(request)));
      parentPort.postMessage({ id, result });
      return;
    }
    if (command === "verifyDevelopment") {
      if (!request || typeof request !== "object" || !request.request || !request.result)
        throw new Error("VerifyDevelopment requires the original request and its BuildDevelopment result.");
      const result = String(globalThis.skillcVerifyDevelopment(
        JSON.stringify(request.request),JSON.stringify(request.result)));
      parentPort.postMessage({ id, result });
      return;
    }
    if (command === "buildDevelopment") {
      const result = JSON.parse(globalThis.skillcBuildDevelopment(JSON.stringify(request)));
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
