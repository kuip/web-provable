import { assertAppReleaseManifest, type AppReleaseManifest } from "./contracts";
import {
  createAppDigestGraph,
  type AppDigestGraphV1,
  type AppTrustDecisionV1,
  type AppTrustPolicy,
} from "./app-provenance";
import { sha256Hex } from "./integrity";
import type { AppBuildIdentityV1 } from "./records";
import type {
  ContentAddressedResourceCache,
  VerifiedResourceCacheWrite,
} from "./resource-cache";
import {
  type AppExecutor,
  WasmXSha3Module,
  WasmXWorkerModule,
} from "./wasmx";

export interface CoreReleaseManifest {
  schemaVersion: 1;
  id: "core";
  kind: "core";
  version: string;
  title: string;
  description: string;
  provides: {
    typescript: "@provable/core";
    wasmx: "provable-wasmx-core";
    wasmxAbi: "provable:app/1";
  };
  module: {
    path: string;
    sha256: string;
  };
}

export interface VerifiedBrowserApp<TInput, TOutput> {
  cache: VerifiedResourceCacheReportV1;
  coreDigest: string;
  coreManifest: CoreReleaseManifest;
  digestGraph: AppDigestGraphV1;
  manifest: AppReleaseManifest;
  manifestDigest: string;
  identity: AppBuildIdentityV1;
  markdown: string;
  moduleDigest: string;
  runner: AppExecutor<TInput, TOutput>;
  sha3: WasmXSha3Module;
  trust: AppTrustDecisionV1;
  uiDigest: string;
}

export interface VerifiedBrowserAppOptions {
  appManifestUrl: string;
  bundleRootUrl: string;
  coreManifestUrl: string;
  resourceCache: ContentAddressedResourceCache;
  trustPolicy: AppTrustPolicy;
  workerUrl: string;
}

export type VerifiedResourceRole =
  | "app-manifest"
  | "app-module"
  | "app-ui"
  | "core-manifest"
  | "core-module";

export interface VerifiedResourceCacheEntryV1 {
  role: VerifiedResourceRole;
  sha256: string;
  write: VerifiedResourceCacheWrite;
}

export interface VerifiedResourceCacheReportV1 {
  schemaVersion: 1;
  entries: VerifiedResourceCacheEntryV1[];
  storedCount: number;
  presentCount: number;
}

const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_UI_BYTES = 2 * 1024 * 1024;
const MAX_WASMX_BYTES = 16 * 1024 * 1024;

/** Loads, digest-checks, and instantiates the browser resources shared by every platform. */
export async function loadVerifiedBrowserApp<TInput, TOutput>(
  options: VerifiedBrowserAppOptions,
): Promise<VerifiedBrowserApp<TInput, TOutput>> {
  const bundleRootUrl = normalizeBundleRootUrl(options.bundleRootUrl);
  assertDistributionRoot(options.trustPolicy.distributionProfile, bundleRootUrl);
  const appManifestUrl = resolveBundledUrl(
    options.appManifestUrl,
    bundleRootUrl,
    "app manifest",
  );
  const coreManifestUrl = resolveBundledUrl(
    options.coreManifestUrl,
    bundleRootUrl,
    "core manifest",
  );
  const workerUrl = resolveBundledUrl(options.workerUrl, bundleRootUrl, "WasmX worker");
  const [manifestResponse, coreManifestResponse] = await Promise.all([
    fetch(appManifestUrl),
    fetch(coreManifestUrl),
  ]);
  assertResponse(manifestResponse, "app manifest", appManifestUrl);
  assertResponse(coreManifestResponse, "core manifest", coreManifestUrl);

  const [manifestBytes, coreManifestBytes] = await Promise.all([
    responseBytes(manifestResponse, "app manifest", MAX_MANIFEST_BYTES),
    responseBytes(coreManifestResponse, "core manifest", MAX_MANIFEST_BYTES),
  ]);
  const manifestValue: unknown = parseJsonBytes(manifestBytes, "app manifest");
  const coreManifestValue: unknown = parseJsonBytes(coreManifestBytes, "core manifest");
  assertAppReleaseManifest(manifestValue);
  assertCoreReleaseManifest(coreManifestValue);
  assertCoreVersionCompatible(manifestValue.coreVersion, coreManifestValue.version);
  const trust = options.trustPolicy.authorize(manifestValue);
  assertSafeResourcePath(manifestValue.module.path, "WasmX module");
  assertSafeResourcePath(manifestValue.ui.path, "UI template");
  assertSafeResourcePath(coreManifestValue.module.path, "core WasmX module");

  const appBaseUrl = new URL("./", manifestResponse.url);
  const coreBaseUrl = new URL("./", coreManifestResponse.url);
  const moduleUrl = assertBundledUrl(
    new URL(manifestValue.module.path, appBaseUrl),
    bundleRootUrl,
    "WasmX module",
  );
  const uiUrl = assertBundledUrl(
    new URL(manifestValue.ui.path, appBaseUrl),
    bundleRootUrl,
    "UI template",
  );
  const coreModuleUrl = assertBundledUrl(
    new URL(coreManifestValue.module.path, coreBaseUrl),
    bundleRootUrl,
    "core WasmX module",
  );
  const [moduleResponse, uiResponse, coreModuleResponse] = await Promise.all([
    fetch(moduleUrl),
    fetch(uiUrl),
    fetch(coreModuleUrl),
  ]);
  assertResponse(moduleResponse, "packaged WasmX module", moduleUrl);
  assertResponse(uiResponse, "packaged UI template", uiUrl);
  assertResponse(coreModuleResponse, "packaged core WasmX module", coreModuleUrl);

  const [moduleBytes, uiBytes, coreModuleBytes] = await Promise.all([
    responseBytes(moduleResponse, "packaged WasmX module", MAX_WASMX_BYTES),
    responseBytes(uiResponse, "packaged UI template", MAX_UI_BYTES),
    responseBytes(coreModuleResponse, "packaged core WasmX module", MAX_WASMX_BYTES),
  ]);
  const [manifestDigest, moduleDigest, uiDigest, coreManifestDigest, coreDigest] = await Promise.all([
    sha256Hex(manifestBytes),
    sha256Hex(moduleBytes),
    sha256Hex(uiBytes),
    sha256Hex(coreManifestBytes),
    sha256Hex(coreModuleBytes),
  ]);
  assertDigest(moduleDigest, manifestValue.module.sha256, "WasmX");
  assertDigest(uiDigest, manifestValue.ui.sha256, "UI");
  assertDigest(coreDigest, coreManifestValue.module.sha256, "core WasmX");

  const digestGraph = await createAppDigestGraph({
    schemaVersion: 1,
    appManifestSha256: manifestDigest,
    appModuleSha256: moduleDigest,
    appUiSha256: uiDigest,
    coreManifestSha256: coreManifestDigest,
    coreModuleSha256: coreDigest,
  });
  const cache = await cacheVerifiedResources(options.resourceCache, [
    { role: "app-manifest", sha256: manifestDigest, bytes: manifestBytes },
    { role: "app-module", sha256: moduleDigest, bytes: moduleBytes },
    { role: "app-ui", sha256: uiDigest, bytes: uiBytes },
    { role: "core-manifest", sha256: coreManifestDigest, bytes: coreManifestBytes },
    { role: "core-module", sha256: coreDigest, bytes: coreModuleBytes },
  ]);
  const [cachedModuleBytes, cachedUiBytes, cachedCoreModuleBytes] = await Promise.all([
    requireCachedResource(options.resourceCache, moduleDigest, "WasmX module"),
    requireCachedResource(options.resourceCache, uiDigest, "UI template"),
    requireCachedResource(options.resourceCache, coreDigest, "core WasmX module"),
  ]);

  const [runner, sha3] = await Promise.all([
    WasmXWorkerModule.instantiate<TInput, TOutput>(cachedModuleBytes, {
      expectedSha256: manifestValue.module.sha256,
      limits: manifestValue.resourceLimits,
      inputSchema: manifestValue.inputSchema,
      outputSchema: manifestValue.outputSchema,
      workerFactory: () => new Worker(workerUrl, {
        type: "module",
        name: `provable-${manifestValue.id}`,
      }),
    }),
    WasmXSha3Module.instantiate(cachedCoreModuleBytes, { maxMemoryPages: 64 }),
  ]);

  return {
    cache,
    coreDigest,
    coreManifest: coreManifestValue,
    digestGraph,
    identity: {
      appId: manifestValue.id,
      appVersion: manifestValue.version,
      publisher: manifestValue.publisher,
      abi: manifestValue.abi,
      manifestSha256: manifestDigest,
      moduleSha256: moduleDigest,
      uiSha256: uiDigest,
      coreVersion: coreManifestValue.version,
      coreModuleSha256: coreDigest,
    },
    manifest: manifestValue,
    manifestDigest,
    markdown: new TextDecoder("utf-8", { fatal: true }).decode(cachedUiBytes),
    moduleDigest,
    runner,
    sha3,
    trust,
    uiDigest,
  };
}

function assertResponse(response: Response, label: string, expectedUrl: URL): void {
  if (!response.ok) {
    throw new Error(`Unable to load ${label} (${response.status})`);
  }
  if (response.redirected || response.url !== expectedUrl.href) {
    throw new Error(`Refusing redirected or substituted ${label}`);
  }
}

async function responseBytes(
  response: Response,
  label: string,
  maximumBytes: number,
): Promise<Uint8Array> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > maximumBytes) {
    throw new Error(`${label} must contain 1–${maximumBytes} bytes`);
  }
  return bytes;
}

function parseJsonBytes(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch (error) {
    throw new Error(`Unable to parse ${label}`, { cause: error });
  }
}

function assertDigest(actual: string, expected: string, label: string): void {
  if (actual !== expected) {
    throw new Error(`Packaged ${label} digest does not match its release manifest`);
  }
}

function assertCoreReleaseManifest(value: unknown): asserts value is CoreReleaseManifest {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, [
      "schemaVersion",
      "id",
      "kind",
      "version",
      "title",
      "description",
      "provides",
      "module",
    ])
    || value.schemaVersion !== 1
    || value.id !== "core"
    || value.kind !== "core"
    || typeof value.version !== "string"
    || !isSemanticVersion(value.version)
    || typeof value.title !== "string"
    || value.title.trim().length === 0
    || typeof value.description !== "string"
    || value.description.trim().length === 0
    || !isRecord(value.provides)
    || !hasOnlyKeys(value.provides, ["typescript", "wasmx", "wasmxAbi"])
    || value.provides.typescript !== "@provable/core"
    || value.provides.wasmx !== "provable-wasmx-core"
    || value.provides.wasmxAbi !== "provable:app/1"
    || !isRecord(value.module)
    || !hasOnlyKeys(value.module, ["path", "sha256"])
    || typeof value.module.path !== "string"
    || typeof value.module.sha256 !== "string"
    || !/^[0-9a-f]{64}$/.test(value.module.sha256)
  ) {
    throw new Error("Invalid core release manifest");
  }
}

function assertCoreVersionCompatible(requirement: string, actual: string): void {
  const requiredVersion = requirement.startsWith("^") ? requirement.slice(1) : requirement;
  const required = parseSemanticVersion(requiredVersion);
  const current = parseSemanticVersion(actual);
  const exact = !requirement.startsWith("^");
  const upper = required[0] > 0
    ? [required[0] + 1, 0, 0] as const
    : required[1] > 0
      ? [0, required[1] + 1, 0] as const
      : [0, 0, required[2] + 1] as const;
  if (
    (exact && compareVersions(current, required) !== 0)
    || (!exact && (
      compareVersions(current, required) < 0
      || compareVersions(current, upper) >= 0
    ))
  ) {
    throw new Error(`App requires Core ${requirement}, but the bundle contains ${actual}`);
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

function normalizeBundleRootUrl(value: string): URL {
  const url = new URL(value);
  url.search = "";
  url.hash = "";
  if (!url.pathname.endsWith("/")) {
    url.pathname = `${url.pathname}/`;
  }
  return url;
}

function assertDistributionRoot(
  profile: AppTrustDecisionV1["distributionProfile"],
  bundleRootUrl: URL,
): void {
  if (profile === "chrome-extension-bundle" && bundleRootUrl.protocol !== "chrome-extension:") {
    throw new Error("Chrome extension bundle root must use chrome-extension:");
  }
  if (
    profile === "github-pages-bundle"
    && bundleRootUrl.protocol !== "https:"
    && !(
      bundleRootUrl.protocol === "http:"
      && isLoopbackHostname(bundleRootUrl.hostname)
    )
  ) {
    throw new Error("GitHub Pages bundle root must use HTTPS or loopback HTTP");
  }
}

function isLoopbackHostname(value: string): boolean {
  return value === "localhost" || value === "127.0.0.1" || value === "[::1]";
}

function resolveBundledUrl(value: string, bundleRootUrl: URL, label: string): URL {
  return assertBundledUrl(new URL(value, bundleRootUrl), bundleRootUrl, label);
}

function assertBundledUrl(value: URL, bundleRootUrl: URL, label: string): URL {
  if (
    value.protocol !== bundleRootUrl.protocol
    || value.host !== bundleRootUrl.host
    || value.username.length > 0
    || value.password.length > 0
    || value.search.length > 0
    || value.hash.length > 0
    || !value.pathname.startsWith(bundleRootUrl.pathname)
  ) {
    throw new Error(`${label} must resolve inside the packaged bundle`);
  }
  return value;
}

async function cacheVerifiedResources(
  cache: ContentAddressedResourceCache,
  resources: Array<{ role: VerifiedResourceRole; sha256: string; bytes: Uint8Array }>,
): Promise<VerifiedResourceCacheReportV1> {
  const entries = await Promise.all(resources.map(async (resource) => ({
    role: resource.role,
    sha256: resource.sha256,
    write: await cache.putVerified(resource.sha256, resource.bytes),
  })));
  return {
    schemaVersion: 1,
    entries,
    storedCount: entries.filter((entry) => entry.write === "stored").length,
    presentCount: entries.filter((entry) => entry.write === "present").length,
  };
}

async function requireCachedResource(
  cache: ContentAddressedResourceCache,
  digest: string,
  label: string,
): Promise<Uint8Array> {
  const bytes = await cache.getVerified(digest);
  if (!bytes) {
    throw new Error(`Verified ${label} is missing from the content-addressed cache`);
  }
  return bytes;
}

function parseSemanticVersion(value: string): readonly [number, number, number] {
  if (!isSemanticVersion(value)) {
    throw new Error(`Invalid semantic version: ${value}`);
  }
  const parts = value.split(".").map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function isSemanticVersion(value: string): boolean {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value);
}

function compareVersions(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number {
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
