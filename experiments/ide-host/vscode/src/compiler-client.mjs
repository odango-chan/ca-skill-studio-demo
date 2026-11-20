// Request/response transport to the pinned Compiler v2.0.2 Go/WASM Worker.
// Browser hosts use Web Worker; Node extension hosts use worker_threads.
// All filesystem access and BuildRequest assembly remain in the extension host.
function workerResourceUrl(uri) {
  const value = uri.toString(true);
  const path = globalThis.location?.pathname ?? "";
  if (!path.endsWith("/plugin-worker.js") ||
      (uri.scheme !== "http" && uri.scheme !== "https")) return value;
  const base = path.slice(0, -"/plugin-worker.js".length);
  if (!base) return value;
  try {
    const origin = globalThis.location.origin;
    const parsed = new URL(value, origin);
    if (parsed.origin !== origin || !parsed.pathname.startsWith("/hostedPlugin/")) return value;
    return base + parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return value;
  }
}

export function createCompilerWorkerClient(vscode, context, {
  WorkerCtor = globalThis.Worker,
  NodeWorkerCtor = null,
  timeoutMs = 60000
} = {}) {
  let worker = null;
  let nextId = 0;
  let disposed = false;
  let queue = Promise.resolve();
  const pending = new Map();

  function failWorker(error, source = worker) {
    if (!source || source !== worker) return;
    worker = null;
    try { void source.terminate(); } catch { /* Already terminated. */ }
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
      pending.delete(id);
    }
  }

  function receiveMessage(data, source) {
    if (source !== worker) return;
    const entry = pending.get(data?.id);
    if (!entry) return;
    pending.delete(data.id);
    clearTimeout(entry.timer);
    if (data.error) entry.reject(new Error(String(data.error)));
    else entry.resolve(data.result);
  }

  async function ensureWorker() {
    if (disposed) throw new Error("Compiler Worker client has been disposed");
    if (worker) return worker;

    if (typeof WorkerCtor === "function") {
      const uri = vscode.Uri.joinPath(context.extensionUri, "dist", "compiler-worker.js");
      const current = new WorkerCtor(workerResourceUrl(uri), {
        name: "skill-studio-compiler-v1alpha5"
      });
      worker = current;
      current.addEventListener("error", event => {
        failWorker(new Error(event?.message || "Compiler Worker crashed"), current);
      });
      current.addEventListener("messageerror", () => {
        failWorker(new Error("Compiler Worker response could not be decoded"), current);
      });
      current.addEventListener("message", event => {
        receiveMessage(event?.data ?? {}, current);
      });
      return current;
    }

    if (typeof process !== "undefined" && process.versions?.node) {
      let NativeWorker = NodeWorkerCtor;
      if (typeof NativeWorker !== "function") {
        const moduleName = "node:" + "worker_threads";
        NativeWorker = (await import(moduleName)).Worker;
      }
      const workerUri = vscode.Uri.joinPath(context.extensionUri, "dist", "compiler-node-worker.mjs");
      const wasmUri = vscode.Uri.joinPath(context.extensionUri, "dist", "skillc.wasm");
      if (typeof workerUri?.fsPath !== "string" || !workerUri.fsPath ||
          typeof wasmUri?.fsPath !== "string" || !wasmUri.fsPath) {
        throw new Error("Node Compiler Worker requires file-backed extension assets.");
      }
      const current = new NativeWorker(workerUri.fsPath, {
        name: "skill-studio-compiler-v1alpha5",
        workerData: { wasmPath: wasmUri.fsPath },
      });
      worker = current;
      current.on("error", error => {
        failWorker(new Error(error?.message || "Compiler Node Worker crashed"), current);
      });
      current.on("messageerror", () => {
        failWorker(new Error("Compiler Node Worker response could not be decoded"), current);
      });
      current.on("message", data => receiveMessage(data ?? {}, current));
      return current;
    }

    throw new Error("This host provides neither Web Worker nor Node worker_threads support for Compiler v2.0.2.");
  }

  async function requestNow(command, request) {
    const current = await ensureWorker();
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new Error("Compiler Worker timed out after " + timeoutMs + " ms");
        pending.delete(id);
        reject(error);
        failWorker(error, current);
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      try {
        current.postMessage({ id, command, request });
      } catch (error) {
        pending.delete(id);
        clearTimeout(timer);
        reject(error);
        failWorker(error, current);
      }
    });
  }

  function request(command, request) {
    if (!["check", "build", "inspect", "verifyArtifact"].includes(command)) {
      return Promise.reject(new Error("Unsupported Compiler command: " + command));
    }
    // Go/WASM calls are synchronous inside either Worker type. Serialize
    // requests so Check / Build / Inspect never contend for one Go runtime.
    const task = queue.then(() => requestNow(command, request),
      () => requestNow(command, request));
    queue = task.catch(() => undefined);
    return task;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (worker) failWorker(new Error("Compiler Worker client disposed"), worker);
  }

  return Object.freeze({ request, dispose, get ready() { return Boolean(worker); } });
}

export { workerResourceUrl };
