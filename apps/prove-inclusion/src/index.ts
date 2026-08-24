import {
  APP_SCHEMA_VERSION,
  WASMX_ABI,
  type KayrosHashRecord,
  type AppSourceManifest,
} from "@provable/core";

export interface ProveInclusionInput {
  a: string;
  b: string;
  n?: number;
}

export interface ProveInclusionOutput {
  count: number;
  result: boolean;
}

export interface ProveInclusionWorkflowDependencies {
  findNotarization: (contentHash: string) => Promise<KayrosHashRecord | undefined>;
  run: (input: ProveInclusionInput) => Promise<ProveInclusionOutput>;
  sha3_256: (value: string) => string;
}

export type ProveInclusionWorkflowResult =
  | { status: "lookup-error"; contentHash: string; error: string }
  | { status: "not-found"; contentHash: string }
  | {
    status: "notarized";
    contentHash: string;
    record: KayrosHashRecord;
    output: ProveInclusionOutput;
  };

export const PROVE_INCLUSION_APP: AppSourceManifest = {
  schemaVersion: APP_SCHEMA_VERSION,
  id: "prove-inclusion",
  kind: "app",
  version: "0.1.0",
  coreVersion: "^0.1.0",
  title: "Prove Inclusion",
  description: "Verify that A is notarized on Kayros, then count how many times B occurs in A.",
  abi: WASMX_ABI,
  module: { path: "app.wasm" },
  ui: { path: "ui.md" },
  fields: [
    { id: "a", label: "Text A", type: "text", role: "input", required: true },
    { id: "b", label: "Text B", type: "text", role: "input", required: true },
    { id: "n", label: "N (optional, defaults to 0)", type: "integer", role: "input" },
    { id: "contentHash", label: "SHA3-256 of A", type: "text", role: "output", readOnly: true },
    { id: "kayrosMatch", label: "Notarized on Kayros", type: "boolean", role: "output", readOnly: true },
    { id: "kayrosTimestamp", label: "Kayros timestamp", type: "text", role: "output", readOnly: true },
    { id: "kayrosBlock", label: "Kayros block / position", type: "integer", role: "output", readOnly: true },
    { id: "count", label: "Occurrences of B in A", type: "integer", role: "output", readOnly: true },
    { id: "result", label: "N < C", type: "boolean", role: "output", readOnly: true },
  ],
  inputSchema: {
    type: "object",
    properties: {
      a: { type: "string" },
      b: { type: "string", minLength: 1 },
      n: { type: "integer", minimum: 0 },
    },
    required: ["a", "b"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      count: { type: "integer", minimum: 0 },
      result: { type: "boolean" },
    },
    required: ["count", "result"],
    additionalProperties: false,
  },
  capabilities: {
    kayros: true,
    drive: true,
    networkOrigins: ["https://kayros.provable.dev"],
  },
  resourceLimits: {
    maxInputBytes: 1024 * 1024,
    maxOutputBytes: 64 * 1024,
    timeoutMs: 5000,
    maxMemoryPages: 64,
  },
};

export function computeProveInclusion(input: ProveInclusionInput): ProveInclusionOutput {
  validateProveInclusionInput(input);
  const n = input.n ?? 0;
  const count = countNonOverlappingOccurrences(input.a, input.b);
  return { count, result: n < count };
}

export async function runProveInclusionWorkflow(
  input: ProveInclusionInput,
  dependencies: ProveInclusionWorkflowDependencies,
): Promise<ProveInclusionWorkflowResult> {
  validateProveInclusionInput(input);
  const contentHash = dependencies.sha3_256(input.a);
  let record: KayrosHashRecord | undefined;
  try {
    record = await dependencies.findNotarization(contentHash);
  } catch (error) {
    return {
      status: "lookup-error",
      contentHash,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  if (!record) {
    return { status: "not-found", contentHash };
  }

  const output = await dependencies.run(input);
  const reference = computeProveInclusion(input);
  if (output.count !== reference.count || output.result !== reference.result) {
    throw new Error("WasmX output did not match the core reference implementation");
  }
  return { status: "notarized", contentHash, record, output };
}

function validateProveInclusionInput(input: ProveInclusionInput): void {
  if (input.b.length === 0) {
    throw new Error("Text B must not be empty");
  }
  const n = input.n ?? 0;
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error("N must be a non-negative integer");
  }
}

export function countNonOverlappingOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) {
    throw new Error("Needle must not be empty");
  }
  let count = 0;
  let offset = 0;
  while (offset <= haystack.length - needle.length) {
    const match = haystack.indexOf(needle, offset);
    if (match === -1) {
      break;
    }
    count += 1;
    offset = match + needle.length;
  }
  return count;
}
