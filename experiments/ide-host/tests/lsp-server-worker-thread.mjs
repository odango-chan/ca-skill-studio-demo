import { parentPort, workerData } from "node:worker_threads";

const listeners = new Map();
globalThis.self = globalThis;
globalThis.addEventListener = (type, listener) => {
  if (type !== "message") return;
  const wrapped = data => listener({ data });
  const entries = listeners.get(listener) ?? [];
  entries.push(wrapped);
  listeners.set(listener, entries);
  parentPort.on("message", wrapped);
};
globalThis.removeEventListener = (type, listener) => {
  if (type !== "message") return;
  for (const wrapped of listeners.get(listener) ?? [])
    parentPort.off("message", wrapped);
  listeners.delete(listener);
};
globalThis.postMessage = message => parentPort.postMessage(message);

await import(workerData.serverUrl);
