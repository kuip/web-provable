import { assertAppResourceLimits } from "./contracts";
import { sha256Hex } from "./integrity";
import {
  assertAppJsonSchema,
  findAppJsonSchemaIssue,
  type AppJsonSchema,
} from "./json-schema";
import {
  WasmXModule,
  WasmXRuntimeError,
  serializeWasmXError,
} from "./wasmx";
import type { WasmXWorkerRequest, WasmXWorkerResponse } from "./wasmx-worker-protocol";

interface WorkerScope {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  postMessage(message: WasmXWorkerResponse): void;
}

const workerScope = globalThis as unknown as WorkerScope;
let module: WasmXModule<unknown, unknown> | undefined;
let inputSchema: AppJsonSchema | undefined;
let outputSchema: AppJsonSchema | undefined;
let initializing = false;

workerScope.addEventListener("message", (event) => {
  void handleMessage(event.data);
});

async function handleMessage(value: unknown): Promise<void> {
  if (!isWorkerRequest(value)) {
    postError(new WasmXRuntimeError("worker-failed", "Invalid WasmX worker request"));
    return;
  }

  if (value.type === "initialize") {
    if (initializing || module) {
      postError(new WasmXRuntimeError(
        "initialization-failed",
        "WasmX worker can initialize only once",
      ));
      return;
    }
    initializing = true;
    try {
      assertAppResourceLimits(value.limits);
      assertAppJsonSchema(value.inputSchema, "WasmX input schema");
      assertAppJsonSchema(value.outputSchema, "WasmX output schema");
      const bytes = new Uint8Array(value.moduleBytes);
      const actualDigest = await sha256Hex(bytes);
      if (actualDigest !== value.expectedSha256) {
        throw new WasmXRuntimeError(
          "integrity-failed",
          "WasmX digest changed before worker instantiation",
        );
      }
      module = await WasmXModule.instantiate(bytes, {
        maxInputBytes: value.limits.maxInputBytes,
        maxOutputBytes: value.limits.maxOutputBytes,
        maxMemoryPages: value.limits.maxMemoryPages,
      });
      inputSchema = value.inputSchema;
      outputSchema = value.outputSchema;
      workerScope.postMessage({ type: "ready" });
    } catch (error) {
      postError(asInitializationError(error));
    } finally {
      initializing = false;
    }
    return;
  }

  if (!module || !inputSchema || !outputSchema) {
    postError(
      new WasmXRuntimeError("initialization-failed", "WasmX worker is not initialized"),
      value.requestId,
    );
    return;
  }

  try {
    let inputValue: unknown;
    try {
      inputValue = JSON.parse(value.inputJson) as unknown;
    } catch (error) {
      throw new WasmXRuntimeError(
        "input-validation-failed",
        "WasmX input is not valid JSON",
        { cause: error },
      );
    }
    const inputIssue = findAppJsonSchemaIssue(inputSchema, inputValue);
    if (inputIssue) {
      throw new WasmXRuntimeError(
        "input-validation-failed",
        `WasmX input ${inputIssue.path} ${inputIssue.message}`,
      );
    }
    const output = module.runJson(value.inputJson);
    const outputIssue = findAppJsonSchemaIssue(outputSchema, output);
    if (outputIssue) {
      throw new WasmXRuntimeError(
        "output-validation-failed",
        `WasmX output ${outputIssue.path} ${outputIssue.message}`,
      );
    }
    workerScope.postMessage({ type: "result", requestId: value.requestId, value: output });
  } catch (error) {
    postError(error, value.requestId);
  }
}

function postError(error: unknown, requestId?: number): void {
  const serialized = serializeWasmXError(error);
  if (requestId === undefined) {
    workerScope.postMessage({ type: "error", error: serialized });
  } else {
    workerScope.postMessage({ type: "error", requestId, error: serialized });
  }
}

function asInitializationError(error: unknown): WasmXRuntimeError {
  if (error instanceof WasmXRuntimeError) {
    return error;
  }
  return new WasmXRuntimeError(
    "initialization-failed",
    error instanceof Error ? error.message : "WasmX worker initialization failed",
    { cause: error },
  );
}

function isWorkerRequest(value: unknown): value is WasmXWorkerRequest {
  if (!isRecord(value)) {
    return false;
  }
  if (value.type === "initialize") {
    return value.moduleBytes instanceof ArrayBuffer
      && typeof value.expectedSha256 === "string"
      && isRecord(value.limits)
      && isRecord(value.inputSchema)
      && isRecord(value.outputSchema);
  }
  return value.type === "run"
    && Number.isSafeInteger(value.requestId)
    && typeof value.inputJson === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
