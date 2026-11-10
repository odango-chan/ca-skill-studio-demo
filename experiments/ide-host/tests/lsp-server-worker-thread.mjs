import { parentPort, workerData } from "node:worker_threads";

const listeners = new Map();
globalThis.self = globalThis;
globalThis.addEventListener = (type, listener) => {
  if (type === "message") {
    const wrapped = data => listener({ data });
    const entries = listeners.get(listener) ?? [];
    entries.push(wrapped);
    listeners.set(listener, entries);
    parentPort.on("message", wrapped);
  } else if (type === "error") {
    // BrowserMessageReader/Writer register this listener on their Worker port.
    parentPort.on("messageerror", event => listener(event));
  }
};
globalThis.removeEventListener = (type, listener) => {
  if (type !== "message") return;
  for (const wrapped of listeners.get(listener) ?? [])
    parentPort.off("message", wrapped);
  listeners.delete(listener);
};
Object.defineProperty(globalThis, "onmessage", {
  configurable: true,
  get() { return this.__workerOnMessage; },
  set(listener) {
    this.__workerOnMessage = listener;
    if (typeof listener === "function")
      parentPort.on("message", data => listener({ data }));
  }
});
globalThis.postMessage = message => parentPort.postMessage(message);

await import(workerData.serverUrl);
