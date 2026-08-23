import { WASMX_ABI } from "./contracts";
import { bytesToHex } from "./integrity";

export interface AppExecutor<TInput, TOutput> {
  run(input: TInput): Promise<TOutput>;
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

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });
const ABI_VERSION = 1;

export class WasmXModule<TInput, TOutput> implements AppExecutor<TInput, TOutput> {
  private constructor(
    private readonly exports: WasmXAppExports,
    private readonly maxOutputBytes: number,
  ) {}

  static async instantiate<TInput, TOutput>(
    bytes: Uint8Array,
    options: { maxOutputBytes?: number } = {},
  ): Promise<WasmXModule<TInput, TOutput>> {
    const instance = await instantiateWithoutImports(bytes);
    const exports = assertAppExports(instance.exports);
    assertAbiVersion(exports);
    return new WasmXModule(exports, options.maxOutputBytes ?? 1024 * 1024);
  }

  async run(input: TInput): Promise<TOutput> {
    const outputBytes = callByteFunction(
      this.exports,
      textEncoder.encode(JSON.stringify(input)),
      (pointer, length) => this.exports.provable_run(pointer, length),
      this.maxOutputBytes,
    );
    const decoded = JSON.parse(textDecoder.decode(outputBytes)) as WasmXWireEnvelope<TOutput>;
    if (!decoded || typeof decoded !== "object" || typeof decoded.ok !== "boolean") {
      throw new Error("WasmX module returned an invalid result envelope");
    }
    if (!decoded.ok) {
      throw new Error(decoded.error ?? "WasmX execution failed");
    }
    if (!("value" in decoded)) {
      throw new Error("WasmX module returned no value");
    }
    return decoded.value as TOutput;
  }
}

/** Shared FIPS SHA3-256 implementation supplied by the packaged core WASM. */
export class WasmXSha3Module {
  private constructor(private readonly exports: WasmXSha3Exports) {}

  static async instantiate(bytes: Uint8Array): Promise<WasmXSha3Module> {
    const instance = await instantiateWithoutImports(bytes);
    const exports = assertSha3Exports(instance.exports);
    assertAbiVersion(exports);
    return new WasmXSha3Module(exports);
  }

  sha3_256(value: string | Uint8Array): string {
    const input = typeof value === "string" ? textEncoder.encode(value) : value;
    const digest = callByteFunction(
      this.exports,
      input,
      (pointer, length) => this.exports.provable_sha3_256(pointer, length),
      32,
    );
    if (digest.byteLength !== 32) {
      throw new Error("Core WasmX returned an invalid SHA3-256 digest length");
    }
    return bytesToHex(digest);
  }
}

async function instantiateWithoutImports(bytes: Uint8Array): Promise<WebAssembly.Instance> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const module = await WebAssembly.compile(copy);
  const imports = WebAssembly.Module.imports(module);
  if (imports.length > 0) {
    throw new Error(`WasmX module imports are not allowed: ${imports.map((item) => `${item.module}.${item.name}`).join(", ")}`);
  }
  return WebAssembly.instantiate(module, {});
}

function callByteFunction(
  exports: WasmXBaseExports,
  inputBytes: Uint8Array,
  call: (pointer: number, length: number) => bigint,
  maxOutputBytes: number,
): Uint8Array {
  const inputPointer = exports.provable_alloc(inputBytes.byteLength);
  assertMemoryRange(exports.memory, inputPointer, inputBytes.byteLength, "input");
  new Uint8Array(exports.memory.buffer, inputPointer, inputBytes.byteLength).set(inputBytes);

  let packedResult: bigint;
  try {
    packedResult = call(inputPointer, inputBytes.byteLength);
  } finally {
    exports.provable_dealloc(inputPointer, inputBytes.byteLength);
  }

  const outputPointer = Number(packedResult >> 32n);
  const outputLength = Number(packedResult & 0xffff_ffffn);
  if (!Number.isSafeInteger(outputLength) || outputLength < 0 || outputLength > maxOutputBytes) {
    throw new Error(`WasmX output exceeds the ${maxOutputBytes}-byte limit`);
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
    throw new Error("WasmX module does not export memory");
  }
  for (const name of [
    "provable_abi_version",
    "provable_alloc",
    "provable_dealloc",
  ] as const) {
    if (typeof candidate[name] !== "function") {
      throw new Error(`WasmX module is missing export: ${name}`);
    }
  }
  return candidate as WasmXBaseExports;
}

function assertAppExports(exports: WebAssembly.Exports): WasmXAppExports {
  const base = assertBaseExports(exports);
  const candidate = exports as Partial<WasmXAppExports>;
  if (typeof candidate.provable_run !== "function") {
    throw new Error("WasmX module is missing export: provable_run");
  }
  return base as WasmXAppExports;
}

function assertSha3Exports(exports: WebAssembly.Exports): WasmXSha3Exports {
  const base = assertBaseExports(exports);
  const candidate = exports as Partial<WasmXSha3Exports>;
  if (typeof candidate.provable_sha3_256 !== "function") {
    throw new Error("Core WasmX module is missing export: provable_sha3_256");
  }
  return base as WasmXSha3Exports;
}

function assertAbiVersion(exports: WasmXBaseExports): void {
  if (exports.provable_abi_version() !== ABI_VERSION) {
    throw new Error(`Module does not implement ${WASMX_ABI}`);
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
    throw new Error(`WasmX ${label} points outside module memory`);
  }
}
