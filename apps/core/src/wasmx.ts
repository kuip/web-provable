import { WASMX_ABI } from "./contracts";

export interface AppExecutor<TInput, TOutput> {
  run(input: TInput): Promise<TOutput>;
}

interface WasmXWireEnvelope<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

interface WasmXExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  web_provable_abi_version: () => number;
  web_provable_alloc: (length: number) => number;
  web_provable_dealloc: (pointer: number, length: number) => void;
  web_provable_run: (pointer: number, length: number) => bigint;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });
const ABI_VERSION = 1;

export class WasmXModule<TInput, TOutput> implements AppExecutor<TInput, TOutput> {
  private constructor(
    private readonly exports: WasmXExports,
    private readonly maxOutputBytes: number,
  ) {}

  static async instantiate<TInput, TOutput>(
    bytes: Uint8Array,
    options: { maxOutputBytes?: number } = {},
  ): Promise<WasmXModule<TInput, TOutput>> {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const module = await WebAssembly.compile(copy);
    const imports = WebAssembly.Module.imports(module);
    if (imports.length > 0) {
      throw new Error(`WasmX module imports are not allowed: ${imports.map((item) => `${item.module}.${item.name}`).join(", ")}`);
    }
    const instance = await WebAssembly.instantiate(module, {});
    const exports = assertExports(instance.exports);
    if (exports.web_provable_abi_version() !== ABI_VERSION) {
      throw new Error(`Module does not implement ${WASMX_ABI}`);
    }
    return new WasmXModule(exports, options.maxOutputBytes ?? 1024 * 1024);
  }

  async run(input: TInput): Promise<TOutput> {
    const inputBytes = textEncoder.encode(JSON.stringify(input));
    const inputPointer = this.exports.web_provable_alloc(inputBytes.byteLength);
    assertMemoryRange(this.exports.memory, inputPointer, inputBytes.byteLength, "input");
    new Uint8Array(this.exports.memory.buffer, inputPointer, inputBytes.byteLength).set(inputBytes);

    let packedResult: bigint;
    try {
      packedResult = this.exports.web_provable_run(inputPointer, inputBytes.byteLength);
    } finally {
      this.exports.web_provable_dealloc(inputPointer, inputBytes.byteLength);
    }

    const outputPointer = Number(packedResult >> 32n);
    const outputLength = Number(packedResult & 0xffff_ffffn);
    if (!Number.isSafeInteger(outputLength) || outputLength < 0 || outputLength > this.maxOutputBytes) {
      throw new Error(`WasmX output exceeds the ${this.maxOutputBytes}-byte limit`);
    }
    assertMemoryRange(this.exports.memory, outputPointer, outputLength, "output");

    let outputBytes: Uint8Array;
    try {
      outputBytes = new Uint8Array(this.exports.memory.buffer, outputPointer, outputLength).slice();
    } finally {
      this.exports.web_provable_dealloc(outputPointer, outputLength);
    }

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

function assertExports(exports: WebAssembly.Exports): WasmXExports {
  const candidate = exports as Partial<WasmXExports>;
  if (!(candidate.memory instanceof WebAssembly.Memory)) {
    throw new Error("WasmX module does not export memory");
  }
  for (const name of [
    "web_provable_abi_version",
    "web_provable_alloc",
    "web_provable_dealloc",
    "web_provable_run",
  ] as const) {
    if (typeof candidate[name] !== "function") {
      throw new Error(`WasmX module is missing export: ${name}`);
    }
  }
  return candidate as WasmXExports;
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

