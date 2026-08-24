import { assertAppReleaseManifest, type AppReleaseManifest } from "./contracts";
import { sha256Hex } from "./integrity";
import {
  type AppExecutor,
  WasmXSha3Module,
  WasmXWorkerModule,
} from "./wasmx";

export interface CoreReleaseManifest {
  id: "core";
  version: string;
  module: {
    path: string;
    sha256: string;
  };
}

export interface VerifiedBrowserApp<TInput, TOutput> {
  coreDigest: string;
  coreManifest: CoreReleaseManifest;
  manifest: AppReleaseManifest;
  markdown: string;
  moduleDigest: string;
  runner: AppExecutor<TInput, TOutput>;
  sha3: WasmXSha3Module;
  uiDigest: string;
}

export interface VerifiedBrowserAppOptions {
  appManifestUrl: string;
  coreManifestUrl: string;
  workerUrl: string;
}

/** Loads, digest-checks, and instantiates the browser resources shared by every platform. */
export async function loadVerifiedBrowserApp<TInput, TOutput>(
  options: VerifiedBrowserAppOptions,
): Promise<VerifiedBrowserApp<TInput, TOutput>> {
  const [manifestResponse, coreManifestResponse] = await Promise.all([
    fetch(options.appManifestUrl),
    fetch(options.coreManifestUrl),
  ]);
  assertResponse(manifestResponse, "app manifest");
  assertResponse(coreManifestResponse, "core manifest");

  const [manifestValue, coreManifestValue]: unknown[] = await Promise.all([
    manifestResponse.json(),
    coreManifestResponse.json(),
  ]);
  assertAppReleaseManifest(manifestValue);
  assertCoreReleaseManifest(coreManifestValue);
  assertSafeResourcePath(manifestValue.module.path, "WasmX module");
  assertSafeResourcePath(manifestValue.ui.path, "UI template");
  assertSafeResourcePath(coreManifestValue.module.path, "core WasmX module");

  const appBaseUrl = new URL("./", manifestResponse.url);
  const coreBaseUrl = new URL("./", coreManifestResponse.url);
  const [moduleResponse, uiResponse, coreModuleResponse] = await Promise.all([
    fetch(new URL(manifestValue.module.path, appBaseUrl)),
    fetch(new URL(manifestValue.ui.path, appBaseUrl)),
    fetch(new URL(coreManifestValue.module.path, coreBaseUrl)),
  ]);
  assertResponse(moduleResponse, "packaged WasmX module");
  assertResponse(uiResponse, "packaged UI template");
  assertResponse(coreModuleResponse, "packaged core WasmX module");

  const [moduleBytes, uiBytes, coreModuleBytes] = await Promise.all([
    responseBytes(moduleResponse),
    responseBytes(uiResponse),
    responseBytes(coreModuleResponse),
  ]);
  const [moduleDigest, uiDigest, coreDigest] = await Promise.all([
    sha256Hex(moduleBytes),
    sha256Hex(uiBytes),
    sha256Hex(coreModuleBytes),
  ]);
  assertDigest(moduleDigest, manifestValue.module.sha256, "WasmX");
  assertDigest(uiDigest, manifestValue.ui.sha256, "UI");
  assertDigest(coreDigest, coreManifestValue.module.sha256, "core WasmX");

  const [runner, sha3] = await Promise.all([
    WasmXWorkerModule.instantiate<TInput, TOutput>(moduleBytes, {
      expectedSha256: manifestValue.module.sha256,
      limits: manifestValue.resourceLimits,
      inputSchema: manifestValue.inputSchema,
      outputSchema: manifestValue.outputSchema,
      workerFactory: () => new Worker(options.workerUrl, {
        type: "module",
        name: `provable-${manifestValue.id}`,
      }),
    }),
    WasmXSha3Module.instantiate(coreModuleBytes, { maxMemoryPages: 64 }),
  ]);

  return {
    coreDigest,
    coreManifest: coreManifestValue,
    manifest: manifestValue,
    markdown: new TextDecoder("utf-8", { fatal: true }).decode(uiBytes),
    moduleDigest,
    runner,
    sha3,
    uiDigest,
  };
}

function assertResponse(response: Response, label: string): void {
  if (!response.ok) {
    throw new Error(`Unable to load ${label} (${response.status})`);
  }
}

async function responseBytes(response: Response): Promise<Uint8Array> {
  return new Uint8Array(await response.arrayBuffer());
}

function assertDigest(actual: string, expected: string, label: string): void {
  if (actual !== expected) {
    throw new Error(`Packaged ${label} digest does not match its release manifest`);
  }
}

function assertCoreReleaseManifest(value: unknown): asserts value is CoreReleaseManifest {
  if (
    !isRecord(value)
    || value.id !== "core"
    || typeof value.version !== "string"
    || !isRecord(value.module)
    || typeof value.module.path !== "string"
    || typeof value.module.sha256 !== "string"
    || !/^[0-9a-f]{64}$/.test(value.module.sha256)
  ) {
    throw new Error("Invalid core release manifest");
  }
}

function assertSafeResourcePath(value: string, label: string): void {
  if (
    value.length === 0
    || value.includes("\\")
    || value.startsWith("/")
    || value.split("/").some((part) => part.length === 0 || part === "." || part === "..")
  ) {
    throw new Error(`Unsafe ${label} path`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
