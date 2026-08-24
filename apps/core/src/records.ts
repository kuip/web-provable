import { canonicalJson, type JsonValue, sha256Hex } from "./integrity";
import type { KayrosHashRecord } from "./kayros";
import { WasmXRuntimeError, type AppExecutor, type WasmXRunOptions } from "./wasmx";

export const LOCAL_RECORD_SCHEMA_VERSION = 1 as const;

export interface AppBuildIdentityV1 {
  appId: string;
  appVersion: string;
  publisher: string;
  abi: string;
  manifestSha256: string;
  moduleSha256: string;
  uiSha256: string;
  coreVersion: string;
  coreModuleSha256: string;
}

export interface RecordErrorV1 {
  code: string;
  message: string;
}

export interface RecordJsonValueV1 {
  encoding: "canonical-json";
  sha256: string;
  value: JsonValue;
}

export interface RecordJsonDigestV1 {
  encoding: "canonical-json";
  sha256: string;
}

export interface KayrosSourceVerificationV1 {
  kind: "kayros-s32-hashes";
  apiBaseUrl: string;
  dataType: string;
  dataItem: string;
  recordHash: string;
  hashType: string;
  timestamp: string;
  timestampId: string;
  block: number;
  locallyVerified: boolean;
  trustAnchored: boolean;
  verificationMethod: "database-match" | "local-chain-hash" | "trusted-root-proof";
}

export type DiagnosticStageV1 =
  | "input-limit"
  | "source-lookup"
  | "source-not-found"
  | "source-verification"
  | "capability"
  | "integrity";

export interface DiagnosticRecordV1 {
  kind: "diagnostic";
  schemaVersion: typeof LOCAL_RECORD_SCHEMA_VERSION;
  id: string;
  createdAt: string;
  app: AppBuildIdentityV1;
  input: RecordJsonDigestV1;
  stage: DiagnosticStageV1;
  error: RecordErrorV1;
  capabilitiesUsed: string[];
  localOnly: true;
  unsigned: true;
  proofEligible: false;
  recordSha256: string;
}

export type ExecutionStatusV1 = "succeeded" | "failed" | "cancelled";
export type ProofIneligibilityReasonV1 =
  | "execution-not-successful"
  | "output-schema-invalid"
  | "source-unverified"
  | "source-unanchored";

export interface ProofEligibilityV1 {
  eligible: boolean;
  reasons: ProofIneligibilityReasonV1[];
}

export interface ExecutionRecordV1 {
  kind: "execution";
  schemaVersion: typeof LOCAL_RECORD_SCHEMA_VERSION;
  id: string;
  startedAt: string;
  endedAt: string;
  app: AppBuildIdentityV1;
  status: ExecutionStatusV1;
  input: RecordJsonValueV1;
  output?: RecordJsonValueV1;
  outputSchemaValid: boolean;
  error?: RecordErrorV1;
  capabilitiesUsed: string[];
  sourceVerification?: KayrosSourceVerificationV1;
  proofEligibility: ProofEligibilityV1;
  notarizationStatus: "not-requested";
  archiveStatus: "not-requested";
  localOnly: true;
  unsigned: true;
  recordSha256: string;
}

export type LocalRecordV1 = DiagnosticRecordV1 | ExecutionRecordV1;

export interface LocalRecordSink {
  put(record: LocalRecordV1): Promise<void>;
}

export interface RecordHost {
  now(): Date;
  randomUUID(): string;
}

export interface CreateDiagnosticRecordOptions {
  app: AppBuildIdentityV1;
  input: unknown;
  stage: DiagnosticStageV1;
  error: RecordErrorV1;
  capabilitiesUsed?: string[];
  host?: RecordHost;
}

export interface ExecuteAndRecordOptions<TOutput> {
  app: AppBuildIdentityV1;
  records: LocalRecordSink;
  capabilitiesUsed?: string[];
  sourceVerification?: KayrosSourceVerificationV1;
  sourceVerificationFromOutput?: (output: TOutput) => KayrosSourceVerificationV1;
  runOptions?: WasmXRunOptions;
  host?: RecordHost;
  onRecord?: (record: ExecutionRecordV1, persistenceError?: Error) => void;
}

export interface ExecuteAndRecordResult<TOutput> {
  output: TOutput;
  record: ExecutionRecordV1;
  persistenceError?: Error;
}

const defaultRecordHost: RecordHost = {
  now: () => new Date(),
  randomUUID: () => crypto.randomUUID(),
};

export async function createDiagnosticRecord(
  options: CreateDiagnosticRecordOptions,
): Promise<DiagnosticRecordV1> {
  const host = options.host ?? defaultRecordHost;
  const input = await jsonDigest(options.input);
  const body = {
    kind: "diagnostic" as const,
    schemaVersion: LOCAL_RECORD_SCHEMA_VERSION,
    id: host.randomUUID(),
    createdAt: host.now().toISOString(),
    app: options.app,
    input,
    stage: options.stage,
    error: options.error,
    capabilitiesUsed: sortedUnique(options.capabilitiesUsed ?? []),
    localOnly: true as const,
    unsigned: true as const,
    proofEligible: false as const,
  };
  return { ...body, recordSha256: await bodyDigest(body) };
}

export async function executeAndRecord<TInput, TOutput>(
  executor: AppExecutor<TInput, TOutput>,
  input: TInput,
  options: ExecuteAndRecordOptions<TOutput>,
): Promise<ExecuteAndRecordResult<TOutput>> {
  const host = options.host ?? defaultRecordHost;
  const id = host.randomUUID();
  const startedAt = host.now().toISOString();
  const inputRecord = await jsonValue(input);
  let output: TOutput;
  let outputRecord: RecordJsonValueV1 | undefined;
  let sourceVerification = options.sourceVerification;

  try {
    output = await executor.run(input, options.runOptions);
    outputRecord = await jsonValue(output);
    sourceVerification = options.sourceVerificationFromOutput?.(output)
      ?? options.sourceVerification;
  } catch (error) {
    const endedAt = host.now().toISOString();
    const status = isCancellation(error) ? "cancelled" : "failed";
    const record = await createExecutionRecord({
      id,
      startedAt,
      endedAt,
      app: options.app,
      status,
      input: inputRecord,
      ...(outputRecord ? { output: outputRecord } : {}),
      outputSchemaValid: outputRecord !== undefined,
      error: recordError(error),
      ...(options.capabilitiesUsed
        ? { capabilitiesUsed: options.capabilitiesUsed }
        : {}),
      ...(sourceVerification
        ? { sourceVerification }
        : {}),
    });
    const persistenceError = await persistRecord(options.records, record);
    options.onRecord?.(record, persistenceError);
    throw error;
  }

  const endedAt = host.now().toISOString();
  const record = await createExecutionRecord({
    id,
    startedAt,
    endedAt,
    app: options.app,
    status: "succeeded",
    input: inputRecord,
    output: outputRecord,
    outputSchemaValid: true,
    ...(options.capabilitiesUsed
      ? { capabilitiesUsed: options.capabilitiesUsed }
      : {}),
    ...(sourceVerification ? { sourceVerification } : {}),
  });
  const persistenceError = await persistRecord(options.records, record);
  options.onRecord?.(record, persistenceError);
  return persistenceError
    ? { output, record, persistenceError }
    : { output, record };
}

export function kayrosSourceVerification(
  record: KayrosHashRecord,
  options: {
    apiBaseUrl: string;
    locallyVerified: boolean;
    trustAnchored?: boolean;
    verificationMethod: KayrosSourceVerificationV1["verificationMethod"];
  },
): KayrosSourceVerificationV1 {
  return {
    kind: "kayros-s32-hashes",
    apiBaseUrl: options.apiBaseUrl,
    dataType: record.dataType,
    dataItem: record.dataItem,
    recordHash: record.hashItem,
    hashType: record.hashType,
    timestamp: record.timestamp,
    timestampId: record.timestampId,
    block: record.block,
    locallyVerified: options.locallyVerified,
    trustAnchored: options.trustAnchored ?? false,
    verificationMethod: options.verificationMethod,
  };
}

export function proofEligibilityFor(
  record: Pick<
    ExecutionRecordV1,
    "status" | "outputSchemaValid" | "sourceVerification"
  >,
): ProofEligibilityV1 {
  const reasons: ProofIneligibilityReasonV1[] = [];
  if (record.status !== "succeeded") {
    reasons.push("execution-not-successful");
  }
  if (!record.outputSchemaValid) {
    reasons.push("output-schema-invalid");
  }
  if (!record.sourceVerification?.locallyVerified) {
    reasons.push("source-unverified");
  } else if (!record.sourceVerification.trustAnchored) {
    reasons.push("source-unanchored");
  }
  return { eligible: reasons.length === 0, reasons };
}

export function isProofActionEligible(record: LocalRecordV1): boolean {
  return record.kind === "execution" && proofEligibilityFor(record).eligible;
}

export function canonicalLocalRecord(record: LocalRecordV1): string {
  return canonicalJson(record as unknown as JsonValue);
}

export async function verifyLocalRecordDigest(record: LocalRecordV1): Promise<boolean> {
  const { recordSha256, ...body } = record;
  if (recordSha256 !== await bodyDigest(body)) {
    return false;
  }
  if (record.kind === "diagnostic") {
    return true;
  }
  if (record.input.sha256 !== await sha256Hex(canonicalJson(record.input.value))) {
    return false;
  }
  return record.output === undefined
    || record.output.sha256 === await sha256Hex(canonicalJson(record.output.value));
}

export function isLocalRecordV1(value: unknown): value is LocalRecordV1 {
  if (!isRecord(value) || value.schemaVersion !== LOCAL_RECORD_SCHEMA_VERSION) {
    return false;
  }
  if (
    !isNonEmptyString(value.id)
    || !isAppBuildIdentity(value.app)
    || !isSha256(value.recordSha256)
    || value.localOnly !== true
    || value.unsigned !== true
  ) {
    return false;
  }
  if (value.kind === "diagnostic") {
    return hasOnlyKeys(value, [
      "kind",
      "schemaVersion",
      "id",
      "createdAt",
      "app",
      "input",
      "stage",
      "error",
      "capabilitiesUsed",
      "localOnly",
      "unsigned",
      "proofEligible",
      "recordSha256",
    ])
      && isIsoTimestamp(value.createdAt)
      && isRecordJsonDigest(value.input)
      && value.proofEligible === false
      && isDiagnosticStage(value.stage)
      && isRecordError(value.error)
      && isSortedUniqueStrings(value.capabilitiesUsed);
  }
  if (
    value.kind !== "execution"
    || !hasOnlyKeys(value, [
      "kind",
      "schemaVersion",
      "id",
      "startedAt",
      "endedAt",
      "app",
      "status",
      "input",
      "output",
      "outputSchemaValid",
      "error",
      "capabilitiesUsed",
      "sourceVerification",
      "proofEligibility",
      "notarizationStatus",
      "archiveStatus",
      "localOnly",
      "unsigned",
      "recordSha256",
    ])
    || !isIsoTimestamp(value.startedAt)
    || !isIsoTimestamp(value.endedAt)
    || value.endedAt < value.startedAt
    || !isExecutionStatus(value.status)
    || !isRecordJsonValue(value.input)
    || ("output" in value && !isRecordJsonValue(value.output))
    || typeof value.outputSchemaValid !== "boolean"
    || ("error" in value && !isRecordError(value.error))
    || !isSortedUniqueStrings(value.capabilitiesUsed)
    || ("sourceVerification" in value
      && !isKayrosSourceVerification(value.sourceVerification))
    || !isProofEligibility(value.proofEligibility)
    || value.notarizationStatus !== "not-requested"
    || value.archiveStatus !== "not-requested"
  ) {
    return false;
  }
  if (
    value.status === "succeeded"
      ? (!("output" in value) || !value.outputSchemaValid || "error" in value)
      : !("error" in value)
  ) {
    return false;
  }
  const expectedEligibility = proofEligibilityFor({
    status: value.status,
    outputSchemaValid: value.outputSchemaValid,
    ...(isKayrosSourceVerification(value.sourceVerification)
      ? { sourceVerification: value.sourceVerification }
      : {}),
  });
  return value.proofEligibility.eligible === expectedEligibility.eligible
    && value.proofEligibility.reasons.length === expectedEligibility.reasons.length
    && value.proofEligibility.reasons.every(
      (reason, index) => reason === expectedEligibility.reasons[index],
    );
}

interface CreateExecutionRecordOptions {
  id: string;
  startedAt: string;
  endedAt: string;
  app: AppBuildIdentityV1;
  status: ExecutionStatusV1;
  input: RecordJsonValueV1;
  output?: RecordJsonValueV1;
  outputSchemaValid: boolean;
  error?: RecordErrorV1;
  capabilitiesUsed?: string[];
  sourceVerification?: KayrosSourceVerificationV1;
}

async function createExecutionRecord(
  options: CreateExecutionRecordOptions,
): Promise<ExecutionRecordV1> {
  const eligibility = proofEligibilityFor(options);
  const body = {
    kind: "execution" as const,
    schemaVersion: LOCAL_RECORD_SCHEMA_VERSION,
    id: options.id,
    startedAt: options.startedAt,
    endedAt: options.endedAt,
    app: options.app,
    status: options.status,
    input: options.input,
    ...(options.output ? { output: options.output } : {}),
    outputSchemaValid: options.outputSchemaValid,
    ...(options.error ? { error: options.error } : {}),
    capabilitiesUsed: sortedUnique(options.capabilitiesUsed ?? []),
    ...(options.sourceVerification ? { sourceVerification: options.sourceVerification } : {}),
    proofEligibility: eligibility,
    notarizationStatus: "not-requested" as const,
    archiveStatus: "not-requested" as const,
    localOnly: true as const,
    unsigned: true as const,
  };
  return { ...body, recordSha256: await bodyDigest(body) };
}

async function jsonValue(value: unknown): Promise<RecordJsonValueV1> {
  const normalized = normalizeJsonValue(value);
  const canonical = canonicalJson(normalized);
  return {
    encoding: "canonical-json",
    sha256: await sha256Hex(canonical),
    value: normalized,
  };
}

async function jsonDigest(value: unknown): Promise<RecordJsonDigestV1> {
  const normalized = normalizeJsonValue(value);
  return {
    encoding: "canonical-json",
    sha256: await sha256Hex(canonicalJson(normalized)),
  };
}

function normalizeJsonValue(value: unknown): JsonValue {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    throw new Error("Record value is not JSON-serializable", { cause: error });
  }
  if (serialized === undefined) {
    throw new Error("Record value is not a JSON value");
  }
  return JSON.parse(serialized) as JsonValue;
}

async function bodyDigest(body: object): Promise<string> {
  return sha256Hex(canonicalJson(body as unknown as JsonValue));
}

async function persistRecord(
  records: LocalRecordSink,
  record: LocalRecordV1,
): Promise<Error | undefined> {
  try {
    await records.put(record);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

function recordError(error: unknown): RecordErrorV1 {
  if (error instanceof WasmXRuntimeError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error) {
    return {
      code: error.name === "AbortError" ? "aborted" : "execution-failed",
      message: error.message,
    };
  }
  return { code: "execution-failed", message: String(error) };
}

function isCancellation(error: unknown): boolean {
  return (error instanceof WasmXRuntimeError && error.code === "aborted")
    || (error instanceof Error && error.name === "AbortError");
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function isAppBuildIdentity(value: unknown): value is AppBuildIdentityV1 {
  return isRecord(value)
    && hasOnlyKeys(value, [
      "appId",
      "appVersion",
      "publisher",
      "abi",
      "manifestSha256",
      "moduleSha256",
      "uiSha256",
      "coreVersion",
      "coreModuleSha256",
    ])
    && isNonEmptyString(value.appId)
    && isNonEmptyString(value.appVersion)
    && isNonEmptyString(value.publisher)
    && isNonEmptyString(value.abi)
    && isSha256(value.manifestSha256)
    && isSha256(value.moduleSha256)
    && isSha256(value.uiSha256)
    && isNonEmptyString(value.coreVersion)
    && isSha256(value.coreModuleSha256);
}

function isRecordJsonValue(value: unknown): value is RecordJsonValueV1 {
  return isRecord(value)
    && hasOnlyKeys(value, ["encoding", "sha256", "value"])
    && value.encoding === "canonical-json"
    && isSha256(value.sha256)
    && isJsonValue(value.value);
}

function isRecordJsonDigest(value: unknown): value is RecordJsonDigestV1 {
  return isRecord(value)
    && hasOnlyKeys(value, ["encoding", "sha256"])
    && value.encoding === "canonical-json"
    && isSha256(value.sha256);
}

function isKayrosSourceVerification(
  value: unknown,
): value is KayrosSourceVerificationV1 {
  return isRecord(value)
    && hasOnlyKeys(value, [
      "kind",
      "apiBaseUrl",
      "dataType",
      "dataItem",
      "recordHash",
      "hashType",
      "timestamp",
      "timestampId",
      "block",
      "locallyVerified",
      "trustAnchored",
      "verificationMethod",
    ])
    && value.kind === "kayros-s32-hashes"
    && isHttpUrl(value.apiBaseUrl)
    && isNonEmptyString(value.dataType)
    && isSha256(value.dataItem)
    && isSha256(value.recordHash)
    && isNonEmptyString(value.hashType)
    && isIsoTimestamp(value.timestamp)
    && typeof value.timestampId === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      value.timestampId,
    )
    && Number.isSafeInteger(value.block)
    && Number(value.block) >= 0
    && typeof value.locallyVerified === "boolean"
    && typeof value.trustAnchored === "boolean"
    && ["database-match", "local-chain-hash", "trusted-root-proof"].includes(
      String(value.verificationMethod),
    );
}

function isProofEligibility(value: unknown): value is ProofEligibilityV1 {
  return isRecord(value)
    && hasOnlyKeys(value, ["eligible", "reasons"])
    && typeof value.eligible === "boolean"
    && Array.isArray(value.reasons)
    && value.reasons.every(isProofIneligibilityReason);
}

function isRecordError(value: unknown): value is RecordErrorV1 {
  return isRecord(value)
    && hasOnlyKeys(value, ["code", "message"])
    && isNonEmptyString(value.code)
    && isNonEmptyString(value.message);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function isDiagnosticStage(value: unknown): value is DiagnosticStageV1 {
  return [
    "input-limit",
    "source-lookup",
    "source-not-found",
    "source-verification",
    "capability",
    "integrity",
  ].includes(String(value));
}

function isExecutionStatus(value: unknown): value is ExecutionStatusV1 {
  return ["succeeded", "failed", "cancelled"].includes(String(value));
}

function isProofIneligibilityReason(
  value: unknown,
): value is ProofIneligibilityReasonV1 {
  return [
    "execution-not-successful",
    "output-schema-invalid",
    "source-unverified",
    "source-unanchored",
  ].includes(String(value));
}

function isSortedUniqueStrings(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.every((item) => typeof item === "string" && item.length > 0)
    && value.every((item, index) => index === 0 || value[index - 1]! < item);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  try {
    const url = new URL(value);
    const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return url.username.length === 0
      && url.password.length === 0
      && (
        url.protocol === "https:"
        || (url.protocol === "http:" && isLoopback)
      );
  } catch {
    return false;
  }
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
