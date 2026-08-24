import {
  KayrosEnvelope,
  keccak256,
  prove_single_hash,
  verifyEnvelopeWithInclusion,
  type EnvelopeVerifyWithInclusionOverrides,
  type ProveOptions,
  type ProveSingleHashResponse,
} from "./kayros-sdk-runtime.js";

import { bytesToHex, equalBytes, hexToBytes, sha256Hex } from "./integrity";

export const DEFAULT_KAYROS_DATA_TYPE = "provable_sdk";

export interface KayrosRequestOptions {
  apiKey?: string;
  dataType?: string;
}

export interface KayrosInclusionOptions extends KayrosRequestOptions {
  trustedRootHash?: string;
  verifyBatchExistence?: boolean;
}

export interface KayrosNotarization {
  dataHash: string;
  response: ProveSingleHashResponse;
}

export interface KayrosVerification {
  valid: boolean;
  error?: string;
  details?: unknown;
}

export interface KayrosConnectionOptions {
  apiKey: string;
  baseUrl?: string;
}

export interface KayrosHashRecord {
  /** Kayros level-0 append position, presented as the record's block/position. */
  block: number;
  dataItem: string;
  dataType: string;
  hashItem: string;
  hashType: string;
  position: number;
  /** Previous level-0 record hash. Missing only when the endpoint omits it. */
  prevHash?: string;
  /** ISO-8601 time decoded from the Kayros UUID v1 timestamp. */
  timestamp: string;
  timestampId: string;
}

export function normalizeKayrosApiKey(value: string): string {
  const normalized = value.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error("Kayros API key must be 0x followed by 64 hexadecimal characters");
  }
  return normalized;
}

interface KayrosDatabaseRow {
  data_item?: unknown;
  data_type?: unknown;
  hash_item?: unknown;
  hash_type?: unknown;
  position?: unknown;
  prev_hash?: unknown;
  ts?: unknown;
}

export async function notarizeBytes(
  bytes: Uint8Array,
  options: KayrosRequestOptions = {},
): Promise<KayrosNotarization> {
  const dataHash = await sha256Hex(bytes);
  const requestOptions: ProveOptions = {
    dataType: options.dataType ?? DEFAULT_KAYROS_DATA_TYPE,
  };
  if (options.apiKey !== undefined) {
    requestOptions.apiKey = options.apiKey;
  }
  const response = await prove_single_hash(dataHash, requestOptions);
  if (!response.success || !response.hash) {
    throw new Error(response.error ?? "Kayros did not return a proof hash");
  }
  return { dataHash, response };
}

export async function verifyEnvelopeForBytes(
  proofJson: string,
  expectedBytes: Uint8Array,
  options: KayrosInclusionOptions = {},
): Promise<KayrosVerification> {
  let envelope: KayrosEnvelope;
  try {
    envelope = KayrosEnvelope.fromJSON(proofJson);
  } catch (error) {
    return { valid: false, error: errorMessage(error) };
  }

  const payloadMatches = await envelopeMatches(envelope, expectedBytes);
  if (!payloadMatches) {
    return { valid: false, error: "Kayros proof payload does not match the expected bytes" };
  }

  const verificationOptions: EnvelopeVerifyWithInclusionOverrides = {
    data_type: options.dataType ?? DEFAULT_KAYROS_DATA_TYPE,
  };
  if (options.apiKey !== undefined) {
    verificationOptions.apiKey = options.apiKey;
  }
  if (options.trustedRootHash !== undefined) {
    verificationOptions.trusted_root_hash = options.trustedRootHash;
  }
  if (options.verifyBatchExistence !== undefined) {
    verificationOptions.verify_batch_existence = options.verifyBatchExistence;
  }

  const verification = await verifyEnvelopeWithInclusion(envelope, verificationOptions);

  const result: KayrosVerification = {
    valid: verification.valid,
  };
  if (verification.error !== undefined) {
    result.error = verification.error;
  }
  if (verification.details !== undefined) {
    result.details = verification.details;
  }
  return result;
}

export async function getLatestKayrosHash(
  options: KayrosConnectionOptions,
  dataType = DEFAULT_KAYROS_DATA_TYPE,
): Promise<KayrosHashRecord> {
  const response = await kayrosFetch(options, "/api/lightnet/database/browse", {
    method: "POST",
    body: JSON.stringify({
      table: "s32_hashes",
      limit: 1,
      offset: 0,
      data_type: dataType,
      order: "desc",
    }),
  });
  const rows = isRecord(response) && Array.isArray(response.rows) ? response.rows : [];
  const row = rows[0];
  if (!isRecord(row)) {
    throw new Error(`Kayros returned no s32_hashes row for ${dataType}`);
  }
  return normalizeDatabaseRow(row);
}

export async function findKayrosRecordBySha3(
  sha3Hex: string,
  options: KayrosConnectionOptions,
  dataType = DEFAULT_KAYROS_DATA_TYPE,
): Promise<KayrosHashRecord | undefined> {
  return (await findKayrosRecordsByDataItem(sha3Hex, options, dataType, 1))[0];
}

export async function findKayrosRecordsByDataItem(
  dataItemHex: string,
  options: KayrosConnectionOptions,
  dataType = DEFAULT_KAYROS_DATA_TYPE,
  limit = 10,
): Promise<KayrosHashRecord[]> {
  const normalizedDataItem = kayrosHashToHex(dataItemHex);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Kayros record limit must be an integer from 1 to 100");
  }
  const dataItem = bytesToBase64(hexToBytes(normalizedDataItem));
  const query = new URLSearchParams({
    data_type: dataType,
    data_item: dataItem,
    limit: String(limit),
  });
  const response = await kayrosFetch(
    options,
    `/api/lightnet/database/record?${query.toString()}`,
  );
  const records = isRecord(response) && Array.isArray(response.records)
    ? response.records
    : [];
  return records.map((row) => {
    if (!isRecord(row)) {
      throw new Error("Kayros returned an invalid s32_hashes record");
    }
    const record = normalizeDatabaseRow(row);
    if (record.dataType !== dataType || record.dataItem !== normalizedDataItem) {
      throw new Error("Kayros returned a record that does not match the data-item query");
    }
    return record;
  });
}

export async function findKayrosRecordByHash(
  recordHashHex: string,
  options: KayrosConnectionOptions,
  dataType = DEFAULT_KAYROS_DATA_TYPE,
): Promise<KayrosHashRecord | undefined> {
  const normalizedRecordHash = kayrosHashToHex(recordHashHex);
  const query = new URLSearchParams({
    hash: bytesToBase64(hexToBytes(normalizedRecordHash)),
    data_type: dataType,
  });
  const response = await kayrosFetchOptional(
    options,
    `/api/lightnet/database/record-by-hash?${query.toString()}`,
  );
  if (response === undefined) {
    return undefined;
  }
  if (!isRecord(response)) {
    throw new Error("Kayros returned an invalid s32_hashes record");
  }
  const record = normalizeDatabaseRow(response);
  if (record.dataType !== dataType || record.hashItem !== normalizedRecordHash) {
    throw new Error("Kayros returned a record that does not match the record-hash query");
  }
  return record;
}

async function envelopeMatches(envelope: KayrosEnvelope, expectedBytes: Uint8Array): Promise<boolean> {
  if (envelope.getDataFormat() !== "raw_hash") {
    return equalBytes(envelope.getData(), expectedBytes);
  }
  const expectedHash = envelope.getHashAlgorithm() === "keccak256"
    ? keccak256(expectedBytes)
    : await sha256Hex(expectedBytes);
  return equalBytes(envelope.getData(), hexToBytes(expectedHash));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function kayrosFetch(
  options: KayrosConnectionOptions,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const response = await requestKayros(options, path, init);
  if (!response.ok) {
    throw new Error(`Kayros API error: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<unknown>;
}

async function kayrosFetchOptional(
  options: KayrosConnectionOptions,
  path: string,
  init: RequestInit = {},
): Promise<unknown | undefined> {
  const response = await requestKayros(options, path, init);
  if (response.status === 404) {
    return undefined;
  }
  if (!response.ok) {
    throw new Error(`Kayros API error: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<unknown>;
}

async function requestKayros(
  options: KayrosConnectionOptions,
  path: string,
  init: RequestInit,
): Promise<Response> {
  if (options.apiKey.length === 0) {
    throw new Error("Kayros API key is not configured");
  }
  const baseUrl = (options.baseUrl ?? "https://kayros.provable.dev").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-User-Key": options.apiKey,
      ...init.headers,
    },
  });
  return response;
}

function normalizeDatabaseRow(row: KayrosDatabaseRow): KayrosHashRecord {
  if (
    typeof row.data_item !== "string"
    || typeof row.data_type !== "string"
    || typeof row.hash_item !== "string"
    || typeof row.hash_type !== "string"
    || typeof row.position !== "number"
    || typeof row.ts !== "string"
  ) {
    throw new Error("Kayros returned an invalid s32_hashes record");
  }
  const record: KayrosHashRecord = {
    block: row.position,
    dataItem: kayrosHashToHex(row.data_item),
    dataType: row.data_type,
    hashItem: kayrosHashToHex(row.hash_item),
    hashType: row.hash_type,
    position: row.position,
    timestamp: kayrosTimeUuidToIso(row.ts),
    timestampId: row.ts,
  };
  if (row.prev_hash !== undefined) {
    if (typeof row.prev_hash !== "string") {
      throw new Error("Kayros returned an invalid previous hash");
    }
    record.prevHash = kayrosHashToHex(row.prev_hash);
  }
  return record;
}

const UUID_GREGORIAN_EPOCH = 0x01b21dd213814000n;

export function kayrosTimeUuidToIso(value: string): string {
  const normalized = value.trim().replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(normalized)) {
    throw new Error("Kayros returned an invalid timestamp UUID");
  }

  const timeLow = BigInt(`0x${normalized.slice(0, 8)}`);
  const timeMid = BigInt(`0x${normalized.slice(8, 12)}`);
  const timeHighAndVersion = BigInt(`0x${normalized.slice(12, 16)}`);
  if (Number(timeHighAndVersion >> 12n) !== 1) {
    throw new Error("Kayros timestamp is not a UUID v1 value");
  }

  const timestamp = timeLow
    | (timeMid << 32n)
    | ((timeHighAndVersion & 0x0fffn) << 48n);
  if (timestamp < UUID_GREGORIAN_EPOCH) {
    throw new Error("Kayros timestamp predates the Unix epoch");
  }

  const unixMillis = Number((timestamp - UUID_GREGORIAN_EPOCH) / 10_000n);
  const date = new Date(unixMillis);
  if (!Number.isFinite(unixMillis) || Number.isNaN(date.getTime())) {
    throw new Error("Kayros returned an out-of-range timestamp UUID");
  }
  return date.toISOString();
}

export function kayrosHashToHex(value: string): string {
  const normalized = value.trim().replace(/^0x/, "");
  if (/^[0-9a-fA-F]{64}$/.test(normalized)) {
    return normalized.toLowerCase();
  }
  const base64 = value.trim().replace(/-/g, "+").replace(/_/g, "/");
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    throw new Error("Kayros returned an invalid encoded hash");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  if (bytes.byteLength !== 32) {
    throw new Error("Kayros returned a hash that is not 32 bytes");
  }
  return bytesToHex(bytes);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
