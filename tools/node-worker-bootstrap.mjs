import { webcrypto } from "node:crypto";
import { parentPort, workerData } from "node:worker_threads";

if (!parentPort || typeof workerData?.entryUrl !== "string") {
  throw new Error("The WasmX test worker requires a parent port and entry URL");
}

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });
}

globalThis.self = globalThis;
globalThis.postMessage = (message, transfer = []) => {
  parentPort.postMessage(message, transfer);
};
globalThis.addEventListener = (type, listener) => {
  if (type === "message") {
    parentPort.on("message", (data) => listener({ data }));
  }
};

await import(workerData.entryUrl);

