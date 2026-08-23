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

export interface AppSourceManifest {
  schemaVersion: typeof APP_SCHEMA_VERSION;
  id: string;
  kind: "app";
  version: string;
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

export function assertAppReleaseManifest(value: unknown): asserts value is AppReleaseManifest {
  if (!isRecord(value)) {
    throw new Error("App manifest must be an object");
  }
  if (value.schemaVersion !== APP_SCHEMA_VERSION) {
    throw new Error(`Unsupported app schema version: ${String(value.schemaVersion)}`);
  }
  if (value.kind !== "app" || typeof value.id !== "string" || value.id.length === 0) {
    throw new Error("App manifest must identify an app");
  }
  if (value.abi !== WASMX_ABI) {
    throw new Error(`Unsupported WasmX ABI: ${String(value.abi)}`);
  }
  assertDigestResource(value.module, "module");
  assertDigestResource(value.ui, "ui");
  if (!Array.isArray(value.fields)) {
    throw new Error("App manifest fields must be an array");
  }
  const fieldIds = new Set<string>();
  for (const field of value.fields) {
    if (!isRecord(field) || typeof field.id !== "string" || field.id.length === 0) {
      throw new Error("Every app field must have an id");
    }
    if (fieldIds.has(field.id)) {
      throw new Error(`Duplicate app field: ${field.id}`);
    }
    fieldIds.add(field.id);
  }
}

function assertDigestResource(value: unknown, label: string): void {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
