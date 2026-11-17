// Classic browser Worker adapter for the pinned Go/WASM Compiler v1.0.0.
// The Worker has no workspace access, network resolver, credentials or Runtime.
let boot = null;

async function ensureCompiler() {
  if (!boot) {
    boot = (async () => {
      importScripts("./wasm_exec.js");
      const go = new Go();
      const response = await fetch("./skillc.wasm");
      if (!response.ok) throw new Error("Unable to fetch pinned skillc.wasm");
      const bytes = await response.arrayBuffer();
      const instance = await WebAssembly.instantiate(bytes, go.importObject);
      // Go's exported callbacks remain alive for the lifetime of this Worker.
      void go.run(instance.instance);
      for (let attempt = 0; attempt < 100; attempt++) {
        if (typeof self.skillcCheck === "function" &&
            typeof self.skillcBuild === "function" &&
            typeof self.skillcInspectDependencies === "function" &&
            typeof self.skillcVerifyArtifact === "function") return;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error("Pinned Go/WASM Compiler did not expose its v1alpha4 callbacks");
    })();
  }
  return boot;
}

self.onmessage = async event => {
  const { id, command, request } = event.data ?? {};
  try {
    if (!Number.isSafeInteger(id) || id < 1) throw new Error("Invalid Compiler Worker request ID");
    await ensureCompiler();
    if (!["check", "build", "inspect", "verifyArtifact"].includes(command)) {
      throw new Error("Unsupported Compiler Worker command");
    }
    if (command === "verifyArtifact") {
      const result = String(self.skillcVerifyArtifact(JSON.stringify(request)));
      self.postMessage({ id, result });
      return;
    }
    const method = command === "check" ? self.skillcCheck :
      command === "inspect" ? self.skillcInspectDependencies : self.skillcBuild;
    const result = JSON.parse(method(JSON.stringify(request)));
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: String(error?.message ?? error) });
  }
};
