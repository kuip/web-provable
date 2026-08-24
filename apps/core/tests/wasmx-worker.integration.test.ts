import { readFile } from "node:fs/promises";
import { Worker as NodeWorker } from "node:worker_threads";

import { describe, expect, it } from "vitest";

import {
  WasmXModule,
  WasmXWorkerModule,
  inspectWasmMemoryLimits,
  sha256Hex,
  type AppJsonSchema,
  type AppResourceLimits,
  type WasmXWorkerFactory,
  type WasmXWorkerLike,
} from "@provable/core";
import {
  PROVE_INCLUSION_APP,
  computeProveInclusion,
  type ProveInclusionInput,
  type ProveInclusionOutput,
} from "@provable/prove-inclusion";

const proveInclusionWasmUrl = new URL(
  "../../../target/wasm32-unknown-unknown/release/prove_inclusion_wasmx.wasm",
  import.meta.url,
);
const runawayWasmUrl = new URL(
  "../../../target/wasm32-unknown-unknown/release/runaway_wasmx_fixture.wasm",
  import.meta.url,
);
const workerBundleUrl = new URL("../../../target/test/wasmx-worker.mjs", import.meta.url);
const workerBootstrapUrl = new URL("../../../tools/node-worker-bootstrap.mjs", import.meta.url);

class NodeWorkerAdapter implements WasmXWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  private readonly worker = new NodeWorker(workerBootstrapUrl, {
    workerData: { entryUrl: workerBundleUrl.href },
  });

  constructor() {
    this.worker.on("message", (data: unknown) => {
      this.onmessage?.({ data } as MessageEvent<unknown>);
    });
    this.worker.on("error", (error) => {
      const message = error instanceof Error ? error.message : String(error);
      this.onerror?.({ error, message } as unknown as ErrorEvent);
    });
  }

  postMessage(message: unknown, transfer: Transferable[] = []): void {
    this.worker.postMessage(message, transfer as ArrayBuffer[]);
  }

  terminate(): void {
    void this.worker.terminate();
  }
}

const workerFactory: WasmXWorkerFactory = () => new NodeWorkerAdapter();
const emptyObjectSchema: AppJsonSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

describe("isolated WasmX worker", () => {
  it("executes a valid app and enforces exact JSON input size", async () => {
    const bytes = new Uint8Array(await readFile(proveInclusionWasmUrl));
    const limits = { ...PROVE_INCLUSION_APP.resourceLimits, maxInputBytes: 80 };
    const module = await instantiateWorker<ProveInclusionInput, ProveInclusionOutput>(bytes, limits);
    const input = { a: "one fish two fish", b: "fish", n: 1 };

    await expect(module.run(input)).resolves.toEqual(computeProveInclusion(input));
    await expect(module.run({ a: "x".repeat(100), b: "x" })).rejects.toMatchObject({
      code: "input-too-large",
    });
    module.dispose();
  });

  it("rehashes transferred bytes immediately before instantiation", async () => {
    const bytes = new Uint8Array(await readFile(proveInclusionWasmUrl));
    await expect(WasmXWorkerModule.instantiate(bytes, {
      expectedSha256: "00".repeat(32),
      limits: PROVE_INCLUSION_APP.resourceLimits,
      inputSchema: PROVE_INCLUSION_APP.inputSchema,
      outputSchema: PROVE_INCLUSION_APP.outputSchema,
      workerFactory,
    })).rejects.toMatchObject({ code: "integrity-failed" });
  });

  it("rejects schema-invalid input before invoking the module", async () => {
    const bytes = new Uint8Array(await readFile(proveInclusionWasmUrl));
    const module = await instantiateWorker<ProveInclusionInput, ProveInclusionOutput>(
      bytes,
      PROVE_INCLUSION_APP.resourceLimits,
    );

    await expect(module.run({ a: "fish", b: "fish", n: "zero" } as unknown as ProveInclusionInput))
      .rejects.toMatchObject({ code: "input-validation-failed" });
    await expect(module.run({ a: "fish", b: "fish", n: 0 })).resolves.toEqual({
      count: 1,
      result: true,
    });
    module.dispose();
  });

  it("rejects a module result that does not match its declared output schema", async () => {
    const bytes = new Uint8Array(await readFile(proveInclusionWasmUrl));
    const incompatibleOutputSchema: AppJsonSchema = {
      type: "object",
      properties: {
        count: { type: "string" },
        result: { type: "boolean" },
      },
      required: ["count", "result"],
      additionalProperties: false,
    };
    const module = await instantiateWorker<ProveInclusionInput, ProveInclusionOutput>(
      bytes,
      PROVE_INCLUSION_APP.resourceLimits,
      PROVE_INCLUSION_APP.inputSchema,
      incompatibleOutputSchema,
    );

    await expect(module.run({ a: "fish", b: "fish" })).rejects.toMatchObject({
      code: "output-validation-failed",
    });
    module.dispose();
  });

  it("rejects unsupported manifest schema keywords before worker creation", async () => {
    const bytes = new Uint8Array(await readFile(proveInclusionWasmUrl));
    const invalidSchema = {
      type: "object",
      properties: {},
      additionalProperties: true,
    } as unknown as AppJsonSchema;

    await expect(WasmXWorkerModule.instantiate(bytes, {
      expectedSha256: await sha256Hex(bytes),
      limits: PROVE_INCLUSION_APP.resourceLimits,
      inputSchema: invalidSchema,
      outputSchema: PROVE_INCLUSION_APP.outputSchema,
      workerFactory,
    })).rejects.toMatchObject({ code: "schema-invalid" });
  });

  it("returns a structured error when output exceeds the declared limit", async () => {
    const bytes = new Uint8Array(await readFile(proveInclusionWasmUrl));
    const limits = { ...PROVE_INCLUSION_APP.resourceLimits, maxOutputBytes: 8 };
    const module = await instantiateWorker<ProveInclusionInput, ProveInclusionOutput>(bytes, limits);

    await expect(module.run({ a: "fish", b: "fish" })).rejects.toMatchObject({
      code: "output-too-large",
    });
    module.dispose();
  });

  it("rejects a module whose declared maximum exceeds its manifest limit", async () => {
    const bytes = new Uint8Array(await readFile(proveInclusionWasmUrl));
    expect(inspectWasmMemoryLimits(bytes)).toMatchObject({ maximumPages: 64 });
    await expect(WasmXModule.instantiate(bytes, { maxMemoryPages: 63 })).rejects.toMatchObject({
      code: "memory-limit",
    });
  });

  it("terminates a runaway module at its wall-clock timeout", async () => {
    const bytes = new Uint8Array(await readFile(runawayWasmUrl));
    const module = await instantiateWorker<unknown, unknown>(
      bytes,
      runtimeLimits(75),
      emptyObjectSchema,
      emptyObjectSchema,
    );

    await expect(module.run({})).rejects.toMatchObject({ code: "timeout" });
    module.dispose();
  }, 10_000);

  it("terminates a runaway module when its AbortSignal is cancelled", async () => {
    const bytes = new Uint8Array(await readFile(runawayWasmUrl));
    const module = await instantiateWorker<unknown, unknown>(
      bytes,
      runtimeLimits(5_000),
      emptyObjectSchema,
      emptyObjectSchema,
    );
    const controller = new AbortController();
    const result = module.run({}, { signal: controller.signal });
    setTimeout(() => controller.abort(), 25);

    await expect(result).rejects.toMatchObject({ code: "aborted" });
    module.dispose();
  }, 10_000);
});

async function instantiateWorker<TInput, TOutput>(
  bytes: Uint8Array,
  limits: AppResourceLimits,
  inputSchema: AppJsonSchema = PROVE_INCLUSION_APP.inputSchema,
  outputSchema: AppJsonSchema = PROVE_INCLUSION_APP.outputSchema,
): Promise<WasmXWorkerModule<TInput, TOutput>> {
  return WasmXWorkerModule.instantiate<TInput, TOutput>(bytes, {
    expectedSha256: await sha256Hex(bytes),
    limits,
    inputSchema,
    outputSchema,
    workerFactory,
  });
}

function runtimeLimits(timeoutMs: number): AppResourceLimits {
  return {
    maxInputBytes: 1024,
    maxOutputBytes: 1024,
    timeoutMs,
    maxMemoryPages: 64,
  };
}
