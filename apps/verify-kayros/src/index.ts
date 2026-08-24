import {
  APP_SCHEMA_VERSION,
  WASMX_ABI,
  hexToBytes,
  kayrosHashToHex,
  type AppSourceManifest,
  type KayrosHashRecord,
} from "@provable/core";

export interface VerifyKayrosLookup {
  recordHash?: string;
  dataItem?: string;
}

export interface VerifyKayrosModuleInput {
  previousHash: string;
  dataType: string;
  dataItem: string;
  timestampId: string;
  hashType: string;
  expectedHash: string;
}

export interface VerifyKayrosOutput {
  computedHash: string;
  matches: boolean;
  inputBytes: number;
}

export interface VerifyKayrosWorkflowDependencies {
  findByRecordHash: (recordHash: string) => Promise<KayrosHashRecord | undefined>;
  findByDataItem: (dataItem: string) => Promise<KayrosHashRecord[]>;
  run: (
    input: VerifyKayrosModuleInput,
    sourceRecord: KayrosHashRecord,
  ) => Promise<VerifyKayrosOutput>;
  sha3_256: (bytes: Uint8Array) => string;
}

export type VerifyKayrosWorkflowResult =
  | { status: "not-found"; lookupKind: "record-hash" | "data-item"; lookupValue: string }
  | { status: "ambiguous"; lookupKind: "data-item"; lookupValue: string; count: number }
  | { status: "verified"; record: KayrosHashRecord; output: VerifyKayrosOutput };

export const VERIFY_KAYROS_APP: AppSourceManifest = {
  schemaVersion: APP_SCHEMA_VERSION,
  id: "verify-kayros",
  kind: "app",
  version: "0.1.0",
  publisher: "github:kuip",
  coreVersion: "^0.1.0",
  title: "Verify Kayros",
  description: "Find a Kayros record and locally recompute its stored record hash.",
  abi: WASMX_ABI,
  module: { path: "app.wasm" },
  ui: { path: "ui.md" },
  fields: [
    { id: "recordHash", label: "Kayros record hash", type: "text", role: "input" },
    { id: "dataItem", label: "Data item", type: "text", role: "input" },
    { id: "lookupStatus", label: "Record lookup", type: "text", role: "output", readOnly: true },
    { id: "recordDataType", label: "Data type", type: "text", role: "output", readOnly: true },
    { id: "recordDataItem", label: "Record data item", type: "text", role: "output", readOnly: true },
    { id: "previousHash", label: "Previous record hash", type: "text", role: "output", readOnly: true },
    { id: "storedHash", label: "Hash stored by Kayros", type: "text", role: "output", readOnly: true },
    { id: "localHash", label: "Locally calculated hash", type: "text", role: "output", readOnly: true },
    { id: "hashType", label: "Hash algorithm", type: "text", role: "output", readOnly: true },
    { id: "hashMatches", label: "Local hash matches Kayros", type: "boolean", role: "output", readOnly: true },
    { id: "kayrosTimestamp", label: "Kayros timestamp", type: "text", role: "output", readOnly: true },
    { id: "kayrosBlock", label: "Kayros block / position", type: "integer", role: "output", readOnly: true },
  ],
  inputSchema: {
    type: "object",
    properties: {
      previousHash: { type: "string" },
      dataType: { type: "string" },
      dataItem: { type: "string" },
      timestampId: { type: "string" },
      hashType: { type: "string" },
      expectedHash: { type: "string" },
    },
    required: [
      "previousHash",
      "dataType",
      "dataItem",
      "timestampId",
      "hashType",
      "expectedHash",
    ],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      computedHash: { type: "string" },
      matches: { type: "boolean" },
      inputBytes: { type: "integer", minimum: 0 },
    },
    required: ["computedHash", "matches", "inputBytes"],
    additionalProperties: false,
  },
  capabilities: {
    kayros: true,
    networkOrigins: ["https://kayros.provable.dev"],
  },
  resourceLimits: {
    maxInputBytes: 16 * 1024,
    maxOutputBytes: 4 * 1024,
    timeoutMs: 5000,
    maxMemoryPages: 64,
  },
};

const ZERO_HASH = "00".repeat(32);
const encoder = new TextEncoder();

export async function runVerifyKayrosWorkflow(
  lookup: VerifyKayrosLookup,
  dependencies: VerifyKayrosWorkflowDependencies,
): Promise<VerifyKayrosWorkflowResult> {
  const normalized = normalizeLookup(lookup);
  let record: KayrosHashRecord | undefined;
  if (normalized.kind === "record-hash") {
    record = await dependencies.findByRecordHash(normalized.value);
  } else {
    const records = await dependencies.findByDataItem(normalized.value);
    if (records.length > 1) {
      return {
        status: "ambiguous",
        lookupKind: "data-item",
        lookupValue: normalized.value,
        count: records.length,
      };
    }
    record = records[0];
  }

  if (!record) {
    return {
      status: "not-found",
      lookupKind: normalized.kind,
      lookupValue: normalized.value,
    };
  }

  const moduleInput = toModuleInput(record);
  const output = await dependencies.run(moduleInput, record);
  const payload = buildKayrosRecordHashInput(moduleInput);
  const referenceHash = dependencies.sha3_256(payload);
  const referenceMatches = referenceHash === moduleInput.expectedHash;
  if (
    output.computedHash !== referenceHash
    || output.matches !== referenceMatches
    || output.inputBytes !== payload.byteLength
  ) {
    throw new Error("Verify Kayros WasmX output did not match the Core SHA3-256 reference");
  }
  return { status: "verified", record, output };
}

export function toModuleInput(record: KayrosHashRecord): VerifyKayrosModuleInput {
  if (record.prevHash === undefined && record.position !== 0) {
    throw new Error("Kayros record is missing the previous hash required for local verification");
  }
  return {
    previousHash: record.prevHash ?? ZERO_HASH,
    dataType: record.dataType,
    dataItem: record.dataItem,
    timestampId: record.timestampId,
    hashType: record.hashType,
    expectedHash: record.hashItem,
  };
}

export function buildKayrosRecordHashInput(input: VerifyKayrosModuleInput): Uint8Array {
  if (input.hashType !== "sha3_256") {
    throw new Error(`Unsupported Kayros hash algorithm: ${input.hashType}`);
  }
  const previousHash = hexToBytes(kayrosHashToHex(input.previousHash));
  const dataItem = hexToBytes(kayrosHashToHex(input.dataItem));
  const timestamp = hexToBytes(normalizeTimestampId(input.timestampId));
  const dataType = encoder.encode(input.dataType);
  if (dataType.byteLength === 0 || dataType.byteLength > 32) {
    throw new Error("Kayros data type must contain 1 to 32 UTF-8 bytes");
  }
  const payload = new Uint8Array(
    previousHash.byteLength + dataType.byteLength + dataItem.byteLength + timestamp.byteLength,
  );
  let offset = 0;
  for (const part of [previousHash, dataType, dataItem, timestamp]) {
    payload.set(part, offset);
    offset += part.byteLength;
  }
  return payload;
}

function normalizeLookup(
  lookup: VerifyKayrosLookup,
): { kind: "record-hash" | "data-item"; value: string } {
  const recordHash = lookup.recordHash?.trim() ?? "";
  const dataItem = lookup.dataItem?.trim() ?? "";
  if ((recordHash.length === 0) === (dataItem.length === 0)) {
    throw new Error("Enter exactly one Kayros record hash or data item");
  }
  return recordHash.length > 0
    ? { kind: "record-hash", value: kayrosHashToHex(recordHash) }
    : { kind: "data-item", value: kayrosHashToHex(dataItem) };
}

function normalizeTimestampId(value: string): string {
  const normalized = value.trim().replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(normalized)) {
    throw new Error("Kayros record has an invalid timestamp UUID");
  }
  return normalized;
}
