import type { AppResourceLimits } from "./contracts";
import { WASMX_ABI } from "./contracts";
import { bytesToHex } from "./integrity";
import {
  assertAppJsonSchema,
  type AppJsonSchema,
} from "./json-schema";
import type {
  WasmXSerializedError,
  WasmXWorkerRequest,
  WasmXWorkerResponse,
} from "./wasmx-worker-protocol";

export const MAX_WASMX_MODULE_BYTES = 8 * 1024 * 1024;

export type WasmXRuntimeErrorCode =
  | "aborted"
  | "busy"
  | "disposed"
  | "execution-failed"
  | "initialization-failed"
  | "input-validation-failed"
  | "input-too-large"
  | "integrity-failed"
  | "memory-limit"
  | "module-too-large"
  | "output-too-large"
  | "output-validation-failed"
  | "schema-invalid"
  | "timeout"
  | "worker-failed";

export class WasmXRuntimeError extends Error {
  readonly code: WasmXRuntimeErrorCode;

  constructor(code: WasmXRuntimeErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WasmXRuntimeError";
    this.code = code;
  }
}

export interface WasmXRunOptions {
  signal?: AbortSignal;
}

export interface AppExecutor<TInput, TOutput> {
  run(input: TInput, options?: WasmXRunOptions): Promise<TOutput>;
}

export interface WasmXModuleOptions {
  maxInputBytes?: number;
  maxOutputBytes?: number;
  maxMemoryPages?: number;
}

export interface WasmXWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
}

export type WasmXWorkerFactory = () => WasmXWorkerLike;

export interface WasmXWorkerModuleOptions {
  expectedSha256: string;
  limits: AppResourceLimits;
  inputSchema: AppJsonSchema;
  outputSchema: AppJsonSchema;
  workerFactory: WasmXWorkerFactory;
  maxModuleBytes?: number;
}

interface WasmXWireEnvelope<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

interface WasmXBaseExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  provable_abi_version: () => number;
  provable_alloc: (length: number) => number;
  provable_dealloc: (pointer: number, length: number) => void;
}

interface WasmXAppExports extends WasmXBaseExports {
  provable_run: (pointer: number, length: number) => bigint;
}

interface WasmXSha3Exports extends WasmXBaseExports {
  provable_sha3_256: (pointer: number, length: number) => bigint;
}

interface PendingInitialization {
  reject: (error: WasmXRuntimeError) => void;
  resolve: () => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

interface PendingRun<TOutput> {
  requestId: number;
  reject: (error: WasmXRuntimeError) => void;
  resolve: (value: TOutput) => void;
  timeoutId: ReturnType<typeof setTimeout>;
  signal: AbortSignal | undefined;
  abortListener: (() => void) | undefined;
}

export interface WasmMemoryLimits {
  initialPages: number;
  maximumPages: number;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });
const ABI_VERSION = 1;
const DEFAULT_MAX_INPUT_BYTES = 1024 * 1024;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_MAX_MEMORY_PAGES = 64;
const WASM_PAGE_BYTES = 64 * 1024;

/** Direct WasmX host used inside the isolated worker and by ABI conformance tests. */
export class WasmXModule<TInput, TOutput> implements AppExecutor<TInput, TOutput> {
  private constructor(
    private readonly exports: WasmXAppExports,
    private readonly maxInputBytes: number,
    private readonly maxOutputBytes: number,
    private readonly maxMemoryPages: number,
  ) {}

  static async instantiate<TInput, TOutput>(
    bytes: Uint8Array,
    options: WasmXModuleOptions = {},
  ): Promise<WasmXModule<TInput, TOutput>> {
    const maxInputBytes = options.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES;
    const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    const maxMemoryPages = options.maxMemoryPages ?? DEFAULT_MAX_MEMORY_PAGES;
    assertPositiveInteger(maxInputBytes, "maximum input size");
    assertPositiveInteger(maxOutputBytes, "maximum output size");
    assertPositiveInteger(maxMemoryPages, "maximum memory pages");
    assertModuleMemoryLimit(bytes, maxMemoryPages);

    const instance = await instantiateWithoutImports(bytes);
    const exports = assertAppExports(instance.exports);
    assertAbiVersion(exports);
    assertRuntimeMemoryLimit(exports.memory, maxMemoryPages);
    return new WasmXModule(
      exports,
      maxInputBytes,
      maxOutputBytes,
      maxMemoryPages,
    );
  }

  async run(input: TInput, options: WasmXRunOptions = {}): Promise<TOutput> {
    if (options.signal?.aborted) {
      throw new WasmXRuntimeError("aborted", "WasmX execution was cancelled");
    }
    let inputJson: string | undefined;
    try {
      inputJson = JSON.stringify(input);
    } catch (error) {
      throw new WasmXRuntimeError(
        "execution-failed",
        "WasmX input is not JSON-serializable",
        { cause: error },
      );
    }
    if (inputJson === undefined) {
      throw new WasmXRuntimeError("execution-failed", "WasmX input is not a JSON value");
    }
    return this.runJson(inputJson);
  }

  runJson(inputJson: string): TOutput {
    const inputBytes = textEncoder.encode(inputJson);
    if (inputBytes.byteLength > this.maxInputBytes) {
      throw new WasmXRuntimeError(
        "input-too-large",
        `WasmX input exceeds the ${this.maxInputBytes}-byte limit`,
      );
    }

    let outputBytes: Uint8Array;
    try {
      outputBytes = callByteFunction(
        this.exports,
        inputBytes,
        (pointer, length) => this.exports.provable_run(pointer, length),
        this.maxOutputBytes,
        this.maxMemoryPages,
      );
    } catch (error) {
      throw asWasmXRuntimeError(error, "execution-failed", "WasmX execution failed");
    }

    let decoded: WasmXWireEnvelope<TOutput>;
    try {
      decoded = JSON.parse(textDecoder.decode(outputBytes)) as WasmXWireEnvelope<TOutput>;
    } catch (error) {
      throw new WasmXRuntimeError(
        "execution-failed",
        "WasmX module returned invalid UTF-8 JSON",
        { cause: error },
      );
    }
    if (!decoded || typeof decoded !== "object" || typeof decoded.ok !== "boolean") {
      throw new WasmXRuntimeError(
        "execution-failed",
        "WasmX module returned an invalid result envelope",
      );
    }
    if (!decoded.ok) {
      throw new WasmXRuntimeError(
        "execution-failed",
        decoded.error ?? "WasmX execution failed",
      );
    }
    if (!("value" in decoded)) {
      throw new WasmXRuntimeError("execution-failed", "WasmX module returned no value");
    }
    return decoded.value as TOutput;
  }
}

/** Terminable one-module worker host used by the browser adapters. */
export class WasmXWorkerModule<TInput, TOutput> implements AppExecutor<TInput, TOutput> {
  private worker: WasmXWorkerLike | undefined;
  private readyPromise: Promise<void> | undefined;
  private initialization: PendingInitialization | undefined;
  private activeRun: PendingRun<TOutput> | undefined;
  private nextRequestId = 1;
  private disposed = false;

  private constructor(
    private readonly moduleBytes: Uint8Array,
    private readonly expectedSha256: string,
    private readonly limits: AppResourceLimits,
    private readonly inputSchema: AppJsonSchema,
    private readonly outputSchema: AppJsonSchema,
    private readonly workerFactory: WasmXWorkerFactory,
  ) {}

  static async instantiate<TInput, TOutput>(
    bytes: Uint8Array,
    options: WasmXWorkerModuleOptions,
  ): Promise<WasmXWorkerModule<TInput, TOutput>> {
    const maxModuleBytes = options.maxModuleBytes ?? MAX_WASMX_MODULE_BYTES;
    assertPositiveInteger(maxModuleBytes, "maximum module size");
    if (bytes.byteLength > maxModuleBytes) {
      throw new WasmXRuntimeError(
        "module-too-large",
        `WasmX module exceeds the ${maxModuleBytes}-byte limit`,
      );
    }
    if (!/^[0-9a-f]{64}$/.test(options.expectedSha256)) {
      throw new WasmXRuntimeError("integrity-failed", "Invalid expected WasmX SHA-256 digest");
    }
    let inputSchema: AppJsonSchema;
    let outputSchema: AppJsonSchema;
    try {
      assertAppJsonSchema(options.inputSchema, "WasmX input schema");
      assertAppJsonSchema(options.outputSchema, "WasmX output schema");
      inputSchema = structuredClone(options.inputSchema);
      outputSchema = structuredClone(options.outputSchema);
    } catch (error) {
      throw new WasmXRuntimeError(
        "schema-invalid",
        error instanceof Error ? error.message : "Invalid WasmX schema",
        { cause: error },
      );
    }

    const moduleBytes = new Uint8Array(bytes.byteLength);
    moduleBytes.set(bytes);
    const module = new WasmXWorkerModule<TInput, TOutput>(
      moduleBytes,
      options.expectedSha256,
      { ...options.limits },
      inputSchema,
      outputSchema,
      options.workerFactory,
    );
    await module.ensureWorker();
    return module;
  }

  async run(input: TInput, options: WasmXRunOptions = {}): Promise<TOutput> {
    if (this.disposed) {
      throw new WasmXRuntimeError("disposed", "WasmX worker has been disposed");
    }
    if (this.activeRun) {
      throw new WasmXRuntimeError("busy", "WasmX worker is already running");
    }
    if (options.signal?.aborted) {
      throw new WasmXRuntimeError("aborted", "WasmX execution was cancelled");
    }

    let inputJson: string | undefined;
    try {
      inputJson = JSON.stringify(input);
    } catch (error) {
      throw new WasmXRuntimeError(
        "execution-failed",
        "WasmX input is not JSON-serializable",
        { cause: error },
      );
    }
    if (inputJson === undefined) {
      throw new WasmXRuntimeError("execution-failed", "WasmX input is not a JSON value");
    }
    if (textEncoder.encode(inputJson).byteLength > this.limits.maxInputBytes) {
      throw new WasmXRuntimeError(
        "input-too-large",
        `WasmX input exceeds the ${this.limits.maxInputBytes}-byte limit`,
      );
    }
    await this.ensureWorker();
    if (this.disposed) {
      throw new WasmXRuntimeError("disposed", "WasmX worker has been disposed");
    }
    if (this.activeRun) {
      throw new WasmXRuntimeError("busy", "WasmX worker is already running");
    }
    if (options.signal?.aborted) {
      throw new WasmXRuntimeError("aborted", "WasmX execution was cancelled");
    }

    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    return new Promise<TOutput>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.failActiveRun(new WasmXRuntimeError(
          "timeout",
          `WasmX execution exceeded the ${this.limits.timeoutMs} ms limit`,
        ));
      }, this.limits.timeoutMs);
      const abortListener = options.signal
        ? () => {
          this.failActiveRun(new WasmXRuntimeError("aborted", "WasmX execution was cancelled"));
        }
        : undefined;
      this.activeRun = {
        requestId,
        reject,
        resolve,
        timeoutId,
        signal: options.signal,
        abortListener,
      };
      if (options.signal && abortListener) {
        options.signal.addEventListener("abort", abortListener, { once: true });
      }

      try {
        this.worker?.postMessage({ type: "run", requestId, inputJson } satisfies WasmXWorkerRequest);
      } catch (error) {
        this.failActiveRun(asWasmXRuntimeError(
          error,
          "worker-failed",
          "Unable to send input to the WasmX worker",
        ));
      }
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    const error = new WasmXRuntimeError("disposed", "WasmX worker has been disposed");
    this.rejectInitialization(error);
    this.rejectActiveRun(error);
    this.terminateWorker();
  }

  private async ensureWorker(): Promise<void> {
    if (this.disposed) {
      throw new WasmXRuntimeError("disposed", "WasmX worker has been disposed");
    }
    if (this.worker && !this.readyPromise) {
      return;
    }
    if (this.readyPromise) {
      return this.readyPromise;
    }

    const readyPromise = this.startWorker();
    this.readyPromise = readyPromise;
    try {
      await readyPromise;
    } finally {
      if (this.readyPromise === readyPromise) {
        this.readyPromise = undefined;
      }
    }
  }

  private startWorker(): Promise<void> {
    let worker: WasmXWorkerLike;
    try {
      worker = this.workerFactory();
    } catch (error) {
      return Promise.reject(asWasmXRuntimeError(
        error,
        "initialization-failed",
        "Unable to create the WasmX worker",
      ));
    }
    this.worker = worker;
    worker.onmessage = (event) => this.handleWorkerMessage(event.data);
    worker.onerror = (event) => {
      const message = event.message || "WasmX worker failed unexpectedly";
      const error = new WasmXRuntimeError("worker-failed", message, { cause: event.error });
      this.rejectInitialization(error);
      this.rejectActiveRun(error);
      this.terminateWorker();
    };

    return new Promise<void>((resolve, reject) => {
      const timeoutMs = Math.max(this.limits.timeoutMs, 10_000);
      const timeoutId = setTimeout(() => {
        const error = new WasmXRuntimeError(
          "initialization-failed",
          `WasmX worker did not initialize within ${timeoutMs} ms`,
        );
        this.rejectInitialization(error);
        this.terminateWorker();
      }, timeoutMs);
      this.initialization = { reject, resolve, timeoutId };

      const moduleCopy = new Uint8Array(this.moduleBytes.byteLength);
      moduleCopy.set(this.moduleBytes);
      try {
        worker.postMessage({
          type: "initialize",
          moduleBytes: moduleCopy.buffer,
          expectedSha256: this.expectedSha256,
          limits: this.limits,
          inputSchema: this.inputSchema,
          outputSchema: this.outputSchema,
        } satisfies WasmXWorkerRequest, [moduleCopy.buffer]);
      } catch (error) {
        this.rejectInitialization(asWasmXRuntimeError(
          error,
          "initialization-failed",
          "Unable to initialize the WasmX worker",
        ));
        this.terminateWorker();
      }
    });
  }

  private handleWorkerMessage(value: unknown): void {
    if (!isWorkerResponse(value)) {
      const error = new WasmXRuntimeError(
        "worker-failed",
        "WasmX worker returned an invalid protocol message",
      );
      this.rejectInitialization(error);
      this.rejectActiveRun(error);
      this.terminateWorker();
      return;
    }

    if (value.type === "ready") {
      const initialization = this.initialization;
      if (!initialization) {
        return;
      }
      clearTimeout(initialization.timeoutId);
      this.initialization = undefined;
      initialization.resolve();
      return;
    }

    if (value.type === "error" && value.requestId === undefined) {
      const error = deserializeWasmXError(value.error, "initialization-failed");
      this.rejectInitialization(error);
      this.terminateWorker();
      return;
    }

    const pending = this.activeRun;
    if (!pending || value.requestId !== pending.requestId) {
      return;
    }
    if (value.type === "error") {
      this.rejectActiveRun(deserializeWasmXError(value.error, "execution-failed"));
      this.terminateWorker();
      return;
    }
    if (value.type === "result") {
      this.finishActiveRun();
      pending.resolve(value.value as TOutput);
    }
  }

  private failActiveRun(error: WasmXRuntimeError): void {
    this.rejectActiveRun(error);
    this.terminateWorker();
  }

  private rejectActiveRun(error: WasmXRuntimeError): void {
    const pending = this.activeRun;
    if (!pending) {
      return;
    }
    this.finishActiveRun();
    pending.reject(error);
  }

  private finishActiveRun(): void {
    const pending = this.activeRun;
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeoutId);
    if (pending.signal && pending.abortListener) {
      pending.signal.removeEventListener("abort", pending.abortListener);
    }
    this.activeRun = undefined;
  }

  private rejectInitialization(error: WasmXRuntimeError): void {
    const initialization = this.initialization;
    if (!initialization) {
      return;
    }
    clearTimeout(initialization.timeoutId);
    this.initialization = undefined;
    initialization.reject(error);
  }

  private terminateWorker(): void {
    const worker = this.worker;
    this.worker = undefined;
    if (!worker) {
      return;
    }
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
  }
}

/** Shared FIPS SHA3-256 implementation supplied by the packaged core WASM. */
export class WasmXSha3Module {
  private constructor(
    private readonly exports: WasmXSha3Exports,
    private readonly maxMemoryPages: number,
  ) {}

  static async instantiate(
    bytes: Uint8Array,
    options: Pick<WasmXModuleOptions, "maxMemoryPages"> = {},
  ): Promise<WasmXSha3Module> {
    const maxMemoryPages = options.maxMemoryPages ?? DEFAULT_MAX_MEMORY_PAGES;
    assertPositiveInteger(maxMemoryPages, "maximum memory pages");
    assertModuleMemoryLimit(bytes, maxMemoryPages);
    const instance = await instantiateWithoutImports(bytes);
    const exports = assertSha3Exports(instance.exports);
    assertAbiVersion(exports);
    assertRuntimeMemoryLimit(exports.memory, maxMemoryPages);
    return new WasmXSha3Module(exports, maxMemoryPages);
  }

  sha3_256(value: string | Uint8Array): string {
    const input = typeof value === "string" ? textEncoder.encode(value) : value;
    const digest = callByteFunction(
      this.exports,
      input,
      (pointer, length) => this.exports.provable_sha3_256(pointer, length),
      32,
      this.maxMemoryPages,
    );
    if (digest.byteLength !== 32) {
      throw new WasmXRuntimeError(
        "execution-failed",
        "Core WasmX returned an invalid SHA3-256 digest length",
      );
    }
    return bytesToHex(digest);
  }
}

export function inspectWasmMemoryLimits(bytes: Uint8Array): WasmMemoryLimits {
  if (
    bytes.byteLength < 8
    || bytes[0] !== 0x00
    || bytes[1] !== 0x61
    || bytes[2] !== 0x73
    || bytes[3] !== 0x6d
    || bytes[4] !== 0x01
    || bytes[5] !== 0x00
    || bytes[6] !== 0x00
    || bytes[7] !== 0x00
  ) {
    throw new WasmXRuntimeError("initialization-failed", "Invalid WebAssembly header");
  }

  let cursor = 8;
  let found: WasmMemoryLimits | undefined;
  while (cursor < bytes.byteLength) {
    const sectionId = bytes[cursor];
    if (sectionId === undefined) {
      break;
    }
    cursor += 1;
    const sectionLength = readU32Leb(bytes, cursor);
    cursor = sectionLength.next;
    const sectionEnd = cursor + sectionLength.value;
    if (!Number.isSafeInteger(sectionEnd) || sectionEnd > bytes.byteLength) {
      throw new WasmXRuntimeError("initialization-failed", "Invalid WebAssembly section length");
    }

    if (sectionId === 5) {
      if (found) {
        throw new WasmXRuntimeError("initialization-failed", "Duplicate WebAssembly memory section");
      }
      const count = readU32Leb(bytes, cursor);
      cursor = count.next;
      if (count.value !== 1) {
        throw new WasmXRuntimeError(
          "memory-limit",
          "WasmX modules must define exactly one linear memory",
        );
      }
      const flags = readU32Leb(bytes, cursor);
      cursor = flags.next;
      if ((flags.value & ~1) !== 0) {
        throw new WasmXRuntimeError(
          "memory-limit",
          "WasmX shared or memory64 memories are not allowed",
        );
      }
      const initial = readU32Leb(bytes, cursor);
      cursor = initial.next;
      if ((flags.value & 1) === 0) {
        throw new WasmXRuntimeError(
          "memory-limit",
          "WasmX memory must declare a hard maximum",
        );
      }
      const maximum = readU32Leb(bytes, cursor);
      cursor = maximum.next;
      if (cursor !== sectionEnd || initial.value > maximum.value) {
        throw new WasmXRuntimeError("initialization-failed", "Invalid WasmX memory limits");
      }
      found = { initialPages: initial.value, maximumPages: maximum.value };
    }
    cursor = sectionEnd;
  }

  if (!found) {
    throw new WasmXRuntimeError("memory-limit", "WasmX module does not define linear memory");
  }
  return found;
}

export function serializeWasmXError(error: unknown): WasmXSerializedError {
  const runtimeError = asWasmXRuntimeError(error, "execution-failed", "WasmX execution failed");
  return { code: runtimeError.code, message: runtimeError.message };
}

function deserializeWasmXError(
  error: WasmXSerializedError,
  fallbackCode: WasmXRuntimeErrorCode,
): WasmXRuntimeError {
  return new WasmXRuntimeError(
    isWasmXRuntimeErrorCode(error.code) ? error.code : fallbackCode,
    error.message,
  );
}

function isWasmXRuntimeErrorCode(value: string): value is WasmXRuntimeErrorCode {
  return [
    "aborted",
    "busy",
    "disposed",
    "execution-failed",
    "initialization-failed",
    "input-validation-failed",
    "input-too-large",
    "integrity-failed",
    "memory-limit",
    "module-too-large",
    "output-too-large",
    "output-validation-failed",
    "schema-invalid",
    "timeout",
    "worker-failed",
  ].includes(value);
}

function isWorkerResponse(value: unknown): value is WasmXWorkerResponse {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }
  if (value.type === "ready") {
    return true;
  }
  if (value.type === "result") {
    return Number.isSafeInteger(value.requestId);
  }
  return value.type === "error"
    && (value.requestId === undefined || Number.isSafeInteger(value.requestId))
    && isRecord(value.error)
    && typeof value.error.code === "string"
    && typeof value.error.message === "string";
}

async function instantiateWithoutImports(bytes: Uint8Array): Promise<WebAssembly.Instance> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  let module: WebAssembly.Module;
  try {
    module = await WebAssembly.compile(copy);
  } catch (error) {
    throw new WasmXRuntimeError(
      "initialization-failed",
      "Unable to compile WasmX module",
      { cause: error },
    );
  }
  const imports = WebAssembly.Module.imports(module);
  if (imports.length > 0) {
    throw new WasmXRuntimeError(
      "initialization-failed",
      `WasmX module imports are not allowed: ${imports.map((item) => `${item.module}.${item.name}`).join(", ")}`,
    );
  }
  try {
    return await WebAssembly.instantiate(module, {});
  } catch (error) {
    throw new WasmXRuntimeError(
      "initialization-failed",
      "Unable to instantiate WasmX module",
      { cause: error },
    );
  }
}

function callByteFunction(
  exports: WasmXBaseExports,
  inputBytes: Uint8Array,
  call: (pointer: number, length: number) => bigint,
  maxOutputBytes: number,
  maxMemoryPages: number,
): Uint8Array {
  assertRuntimeMemoryLimit(exports.memory, maxMemoryPages);
  const inputPointer = exports.provable_alloc(inputBytes.byteLength);
  assertRuntimeMemoryLimit(exports.memory, maxMemoryPages);
  assertMemoryRange(exports.memory, inputPointer, inputBytes.byteLength, "input");
  new Uint8Array(exports.memory.buffer, inputPointer, inputBytes.byteLength).set(inputBytes);

  let packedResult: bigint;
  try {
    packedResult = call(inputPointer, inputBytes.byteLength);
  } finally {
    exports.provable_dealloc(inputPointer, inputBytes.byteLength);
  }
  assertRuntimeMemoryLimit(exports.memory, maxMemoryPages);

  const outputPointer = Number(packedResult >> 32n);
  const outputLength = Number(packedResult & 0xffff_ffffn);
  if (!Number.isSafeInteger(outputLength) || outputLength < 0 || outputLength > maxOutputBytes) {
    throw new WasmXRuntimeError(
      "output-too-large",
      `WasmX output exceeds the ${maxOutputBytes}-byte limit`,
    );
  }
  assertMemoryRange(exports.memory, outputPointer, outputLength, "output");

  try {
    return new Uint8Array(exports.memory.buffer, outputPointer, outputLength).slice();
  } finally {
    exports.provable_dealloc(outputPointer, outputLength);
  }
}

function assertBaseExports(exports: WebAssembly.Exports): WasmXBaseExports {
  const candidate = exports as Partial<WasmXBaseExports>;
  if (!(candidate.memory instanceof WebAssembly.Memory)) {
    throw new WasmXRuntimeError("initialization-failed", "WasmX module does not export memory");
  }
  for (const name of [
    "provable_abi_version",
    "provable_alloc",
    "provable_dealloc",
  ] as const) {
    if (typeof candidate[name] !== "function") {
      throw new WasmXRuntimeError(
        "initialization-failed",
        `WasmX module is missing export: ${name}`,
      );
    }
  }
  return candidate as WasmXBaseExports;
}

function assertAppExports(exports: WebAssembly.Exports): WasmXAppExports {
  const base = assertBaseExports(exports);
  const candidate = exports as Partial<WasmXAppExports>;
  if (typeof candidate.provable_run !== "function") {
    throw new WasmXRuntimeError(
      "initialization-failed",
      "WasmX module is missing export: provable_run",
    );
  }
  return base as WasmXAppExports;
}

function assertSha3Exports(exports: WebAssembly.Exports): WasmXSha3Exports {
  const base = assertBaseExports(exports);
  const candidate = exports as Partial<WasmXSha3Exports>;
  if (typeof candidate.provable_sha3_256 !== "function") {
    throw new WasmXRuntimeError(
      "initialization-failed",
      "Core WasmX module is missing export: provable_sha3_256",
    );
  }
  return base as WasmXSha3Exports;
}

function assertAbiVersion(exports: WasmXBaseExports): void {
  if (exports.provable_abi_version() !== ABI_VERSION) {
    throw new WasmXRuntimeError(
      "initialization-failed",
      `Module does not implement ${WASMX_ABI}`,
    );
  }
}

function assertModuleMemoryLimit(bytes: Uint8Array, maxMemoryPages: number): void {
  const limits = inspectWasmMemoryLimits(bytes);
  if (limits.initialPages > maxMemoryPages || limits.maximumPages > maxMemoryPages) {
    throw new WasmXRuntimeError(
      "memory-limit",
      `WasmX memory declaration exceeds the ${maxMemoryPages}-page limit`,
    );
  }
}

function assertRuntimeMemoryLimit(memory: WebAssembly.Memory, maxMemoryPages: number): void {
  const pages = memory.buffer.byteLength / WASM_PAGE_BYTES;
  if (!Number.isInteger(pages) || pages > maxMemoryPages) {
    throw new WasmXRuntimeError(
      "memory-limit",
      `WasmX memory exceeds the ${maxMemoryPages}-page limit`,
    );
  }
}

function assertMemoryRange(
  memory: WebAssembly.Memory,
  pointer: number,
  length: number,
  label: string,
): void {
  if (
    !Number.isSafeInteger(pointer)
    || !Number.isSafeInteger(length)
    || pointer < 0
    || length < 0
    || pointer + length > memory.buffer.byteLength
  ) {
    throw new WasmXRuntimeError(
      "execution-failed",
      `WasmX ${label} points outside module memory`,
    );
  }
}

function readU32Leb(bytes: Uint8Array, start: number): { value: number; next: number } {
  let value = 0;
  let multiplier = 1;
  let cursor = start;
  for (let index = 0; index < 5; index += 1) {
    const byte = bytes[cursor];
    if (byte === undefined) {
      throw new WasmXRuntimeError("initialization-failed", "Truncated WebAssembly integer");
    }
    cursor += 1;
    value += (byte & 0x7f) * multiplier;
    if ((byte & 0x80) === 0) {
      if (!Number.isSafeInteger(value) || (index === 4 && byte > 0x0f)) {
        break;
      }
      return { value, next: cursor };
    }
    multiplier *= 128;
  }
  throw new WasmXRuntimeError("initialization-failed", "Invalid WebAssembly integer");
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new WasmXRuntimeError("initialization-failed", `Invalid ${label}`);
  }
}

function asWasmXRuntimeError(
  error: unknown,
  fallbackCode: WasmXRuntimeErrorCode,
  fallbackMessage: string,
): WasmXRuntimeError {
  if (error instanceof WasmXRuntimeError) {
    return error;
  }
  return new WasmXRuntimeError(
    fallbackCode,
    error instanceof Error && error.message.length > 0 ? error.message : fallbackMessage,
    { cause: error },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
