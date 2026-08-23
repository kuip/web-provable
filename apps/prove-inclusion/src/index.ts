import {
  APP_SCHEMA_VERSION,
  WASMX_ABI,
  type AppSourceManifest,
} from "@web-provable/core";

export interface ProveInclusionInput {
  a: string;
  b: string;
  n?: number;
}

export interface ProveInclusionOutput {
  count: number;
  result: boolean;
}

export const PROVE_INCLUSION_APP: AppSourceManifest = {
  schemaVersion: APP_SCHEMA_VERSION,
  id: "prove-inclusion",
  kind: "app",
  version: "0.1.0",
  coreVersion: "^0.1.0",
  title: "Prove Inclusion",
  description: "Verify a Kayros-notarized text and prove whether another text occurs more than N times.",
  abi: WASMX_ABI,
  module: { path: "app.wasm" },
  ui: { path: "ui.md" },
  fields: [
    { id: "a", label: "Text A", type: "text", role: "input", required: true },
    { id: "proofA", label: "Kayros proof of A", type: "proof", role: "input", required: true },
    { id: "b", label: "Text B", type: "text", role: "input", required: true },
    { id: "n", label: "N", type: "integer", role: "input", default: 0 },
    { id: "count", label: "Count C", type: "integer", role: "output", readOnly: true },
    { id: "result", label: "N < C", type: "boolean", role: "output", readOnly: true },
  ],
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
  if (input.b.length === 0) {
    throw new Error("Text B must not be empty");
  }
  const n = input.n ?? 0;
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error("N must be a non-negative integer");
  }
  const count = countNonOverlappingOccurrences(input.a, input.b);
  return { count, result: n < count };
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

