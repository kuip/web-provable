import { assertAppJsonSchema, type AppJsonSchema } from "./json-schema";

export const APP_SCHEMA_VERSION = 1 as const;
export const WASMX_ABI = "provable:app/1" as const;

export type AppFieldType = "text" | "integer" | "boolean" | "proof";
export type AppFieldRole = "input" | "output";

export interface AppFieldDefinition {
  id: string;
  label: string;
  type: AppFieldType;
  role: AppFieldRole;
  required?: boolean;
  readOnly?: boolean;
  default?: string | number | boolean;
}

export interface AppCapabilities {
  kayros?: boolean;
  drive?: boolean;
  networkOrigins?: string[];
}

export interface AppResourceLimits {
  maxInputBytes: number;
  maxOutputBytes: number;
  timeoutMs: number;
  maxMemoryPages: number;
}

export const APP_RESOURCE_LIMIT_CAPS = {
  maxInputBytes: 16 * 1024 * 1024,
  maxOutputBytes: 16 * 1024 * 1024,
  timeoutMs: 60_000,
  maxMemoryPages: 256,
} as const;

export interface AppSourceManifest {
  schemaVersion: typeof APP_SCHEMA_VERSION;
  id: string;
  kind: "app";
  version: string;
  publisher: string;
  coreVersion: string;
  title: string;
  description: string;
  abi: typeof WASMX_ABI;
  module: {
    path: string;
  };
  ui: {
    path: string;
  };
  fields: AppFieldDefinition[];
  inputSchema: AppJsonSchema;
  outputSchema: AppJsonSchema;
  capabilities: AppCapabilities;
  resourceLimits: AppResourceLimits;
}

export interface AppReleaseManifest extends Omit<AppSourceManifest, "module" | "ui"> {
  module: AppSourceManifest["module"] & {
    sha256: string;
  };
  ui: AppSourceManifest["ui"] & {
    sha256: string;
  };
}

const APP_MANIFEST_KEYS = [
  "schemaVersion",
  "id",
  "kind",
  "version",
  "publisher",
  "coreVersion",
  "title",
  "description",
  "abi",
  "module",
  "ui",
  "fields",
  "inputSchema",
  "outputSchema",
  "capabilities",
  "resourceLimits",
] as const;

const APP_FIELD_TYPES = new Set<AppFieldType>(["text", "integer", "boolean", "proof"]);
const APP_FIELD_ROLES = new Set<AppFieldRole>(["input", "output"]);

export function assertAppReleaseManifest(value: unknown): asserts value is AppReleaseManifest {
  if (!isRecord(value)) {
    throw new Error("App manifest must be an object");
  }
  assertKnownKeys(value, APP_MANIFEST_KEYS, "App manifest");
  if (value.schemaVersion !== APP_SCHEMA_VERSION) {
    throw new Error(`Unsupported app schema version: ${String(value.schemaVersion)}`);
  }
  if (value.kind !== "app" || typeof value.id !== "string" || value.id.length === 0) {
    throw new Error("App manifest must identify an app");
  }
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(value.id)) {
    throw new Error("App manifest has an invalid app id");
  }
  if (
    typeof value.publisher !== "string"
    || !/^[A-Za-z0-9][A-Za-z0-9:._/-]{0,127}$/.test(value.publisher)
  ) {
    throw new Error("App manifest must identify its publisher");
  }
  for (const key of ["version", "coreVersion", "title", "description"] as const) {
    if (typeof value[key] !== "string" || value[key].trim().length === 0) {
      throw new Error(`App manifest must define ${key}`);
    }
  }
  const version = String(value.version);
  const coreVersion = String(value.coreVersion);
  assertSemanticVersion(version, "App version");
  assertCoreVersionRange(coreVersion);
  if (value.abi !== WASMX_ABI) {
    throw new Error(`Unsupported WasmX ABI: ${String(value.abi)}`);
  }
  assertDigestResource(value.module, "module");
  assertDigestResource(value.ui, "ui");
  assertAppJsonSchema(value.inputSchema, "App input schema");
  assertAppJsonSchema(value.outputSchema, "App output schema");
  assertAppCapabilities(value.capabilities);
  assertAppResourceLimits(value.resourceLimits);
  if (!Array.isArray(value.fields) || value.fields.length > 128) {
    throw new Error("App manifest fields must be an array of at most 128 fields");
  }
  const fieldIds = new Set<string>();
  for (const field of value.fields) {
    if (!isRecord(field)) {
      throw new Error("Every app field must be an object");
    }
    assertKnownKeys(
      field,
      ["id", "label", "type", "role", "required", "readOnly", "default"],
      "App field",
    );
    if (typeof field.id !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(field.id)) {
      throw new Error("Every app field must have an id");
    }
    if (fieldIds.has(field.id)) {
      throw new Error(`Duplicate app field: ${field.id}`);
    }
    fieldIds.add(field.id);
    if (
      typeof field.label !== "string"
      || field.label.trim().length === 0
      || field.label.length > 256
    ) {
      throw new Error(`App field ${field.id} must have a label`);
    }
    if (typeof field.type !== "string" || !APP_FIELD_TYPES.has(field.type as AppFieldType)) {
      throw new Error(`App field ${field.id} has an unsupported type`);
    }
    if (typeof field.role !== "string" || !APP_FIELD_ROLES.has(field.role as AppFieldRole)) {
      throw new Error(`App field ${field.id} has an unsupported role`);
    }
    assertOptionalBoolean(field.required, `App field ${field.id}.required`);
    assertOptionalBoolean(field.readOnly, `App field ${field.id}.readOnly`);
    if (field.role === "output" && field.readOnly !== true) {
      throw new Error(`App output field ${field.id} must be read-only`);
    }
    if (field.role === "input" && field.readOnly === true) {
      throw new Error(`App input field ${field.id} cannot be read-only`);
    }
    assertFieldDefault(field);
  }
}

export function assertAppCapabilities(value: unknown): asserts value is AppCapabilities {
  if (!isRecord(value)) {
    throw new Error("App manifest capabilities must be an object");
  }
  assertKnownKeys(value, ["kayros", "drive", "networkOrigins"], "App capabilities");
  assertOptionalBoolean(value.kayros, "App capability kayros");
  assertOptionalBoolean(value.drive, "App capability drive");
  if (value.networkOrigins === undefined) {
    return;
  }
  if (!Array.isArray(value.networkOrigins) || value.networkOrigins.length > 32) {
    throw new Error("App capability networkOrigins must be an array of at most 32 origins");
  }
  const origins = new Set<string>();
  for (const origin of value.networkOrigins) {
    if (typeof origin !== "string" || !isExactHttpsOrigin(origin)) {
      throw new Error("App capability networkOrigins contains an invalid HTTPS origin");
    }
    if (origins.has(origin)) {
      throw new Error(`Duplicate app network origin: ${origin}`);
    }
    origins.add(origin);
  }
}

export function assertAppResourceLimits(value: unknown): asserts value is AppResourceLimits {
  if (!isRecord(value)) {
    throw new Error("App manifest resource limits must be an object");
  }
  assertKnownKeys(
    value,
    ["maxInputBytes", "maxOutputBytes", "timeoutMs", "maxMemoryPages"],
    "App resource limits",
  );
  for (const key of [
    "maxInputBytes",
    "maxOutputBytes",
    "timeoutMs",
    "maxMemoryPages",
  ] as const) {
    const limit = value[key];
    if (
      typeof limit !== "number"
      || !Number.isSafeInteger(limit)
      || limit <= 0
      || limit > APP_RESOURCE_LIMIT_CAPS[key]
    ) {
      throw new Error(
        `Invalid ${key} resource limit; expected 1–${APP_RESOURCE_LIMIT_CAPS[key]}`,
      );
    }
  }
}

function assertDigestResource(value: unknown, label: string): void {
  if (isRecord(value)) {
    assertKnownKeys(value, ["path", "sha256"], `App ${label} resource`);
  }
  if (
    !isRecord(value)
    || typeof value.path !== "string"
    || value.path.length === 0
    || typeof value.sha256 !== "string"
    || !/^[0-9a-f]{64}$/.test(value.sha256)
  ) {
    throw new Error(`Invalid ${label} resource in app manifest`);
  }
}

function assertFieldDefault(field: Record<string, unknown>): void {
  if (field.default === undefined) {
    return;
  }
  const type = field.type;
  const valid = (type === "text" || type === "proof")
    ? typeof field.default === "string"
    : type === "integer"
      ? Number.isSafeInteger(field.default)
      : type === "boolean" && typeof field.default === "boolean";
  if (!valid) {
    throw new Error(`App field ${String(field.id)} has a default with the wrong type`);
  }
}

function assertOptionalBoolean(value: unknown, label: string): void {
  if (value !== undefined && typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
}

function assertSemanticVersion(value: string, label: string): void {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${label} must be a semantic version`);
  }
}

function assertCoreVersionRange(value: string): void {
  const version = value.startsWith("^") ? value.slice(1) : value;
  assertSemanticVersion(version, "Core version compatibility");
}

function isExactHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.username.length === 0
      && url.password.length === 0
      && url.pathname === "/"
      && url.search.length === 0
      && url.hash.length === 0
      && value === url.origin;
  } catch {
    return false;
  }
}

function assertKnownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const allowedKeys = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unknown) {
    throw new Error(`${label} contains unsupported field: ${unknown}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
