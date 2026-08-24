import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, "dist/chrome");
const extensionManifest = await readJson(join(output, "manifest.json"));

assert(extensionManifest.manifest_version === 3, "Chrome artifact must use Manifest V3");
assert(extensionManifest.name === "Provable", "Unexpected extension name");
assert(extensionManifest.background?.service_worker === "background.js", "Missing local service worker");
assert(extensionManifest.side_panel?.default_path === "panel.html", "Missing local side panel");
assert(
  Array.isArray(extensionManifest.permissions)
    && extensionManifest.permissions.includes("storage"),
  "Chrome artifact must permit local Core settings storage",
);
assert(
  extensionManifest.content_security_policy?.extension_pages
    === "script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; object-src 'none'",
  "Unexpected extension-page content security policy",
);

await Promise.all([
  readFile(join(output, extensionManifest.background.service_worker)),
  readFile(join(output, extensionManifest.side_panel.default_path)),
  readFile(join(output, "panel.js")),
  readFile(join(output, "wasmx-worker.js")),
  readFile(join(output, "styles.css")),
]);

const runtimeConfig = await readJson(join(output, "config.json"));
assert(runtimeConfig.schemaVersion === 1, "Unexpected runtime config version");
assert(
  runtimeConfig.profile === "development" || runtimeConfig.profile === "store",
  "Unexpected runtime config profile",
);
if (runtimeConfig.profile === "store") {
  assert(runtimeConfig.kayros?.apiKey === "", "Store artifact must not contain a Kayros API key");
}

const appVerifications = await Promise.all([
  verifyApp("prove-inclusion", "Prove Inclusion"),
  verifyApp("verify-kayros", "Verify Kayros"),
]);

const coreRoot = join(output, "apps/core");
const coreManifest = await readJson(join(coreRoot, "app.json"));
const coreModuleBytes = await verifyResource(coreRoot, coreManifest.module, "core module");
const coreImports = await verifyWasm(coreModuleBytes, [
  "memory",
  "provable_abi_version",
  "provable_alloc",
  "provable_dealloc",
  "provable_sha3_256",
], "core");

console.log(`Verified Chrome artifact at ${output}`);
console.log(`WasmX imports: apps=${appVerifications.map((app) => `${app.id}:${app.imports}`).join(",")}, core=${coreImports}`);
for (const app of appVerifications) {
  console.log(`${app.title} SHA-256: ${app.manifest.module.sha256}`);
}
console.log(`Core SHA-256: ${coreManifest.module.sha256}`);

async function verifyApp(id, title) {
  const appRoot = join(output, "apps", id);
  const manifest = await readJson(join(appRoot, "app.json"));
  assert(manifest.id === id, `Unexpected ${title} app id`);
  assert(manifest.abi === "provable:app/1", `Unexpected ${title} app ABI`);
  assertClosedObjectSchema(manifest.inputSchema, `${title} input`);
  assertClosedObjectSchema(manifest.outputSchema, `${title} output`);
  const moduleBytes = await verifyResource(appRoot, manifest.module, `${title} module`);
  await verifyResource(appRoot, manifest.ui, `${title} UI`);
  const imports = await verifyWasm(moduleBytes, [
    "memory",
    "provable_abi_version",
    "provable_alloc",
    "provable_dealloc",
    "provable_run",
  ], title);
  return { id, title, manifest, imports };
}

function assertClosedObjectSchema(schema, label) {
  assert(
    schema?.type === "object"
      && schema.properties
      && typeof schema.properties === "object"
      && schema.additionalProperties === false,
    `Invalid ${label} schema`,
  );
}

async function verifyWasm(bytes, requiredExports, label) {
  const wasmModule = await WebAssembly.compile(bytes);
  const imports = WebAssembly.Module.imports(wasmModule);
  assert(
    imports.length === 0,
    `Packaged ${label} WasmX module has forbidden imports: ${imports
      .map((item) => `${item.module}.${item.name}`)
      .join(", ")}`,
  );
  const exports = new Set(WebAssembly.Module.exports(wasmModule).map((item) => item.name));
  for (const name of requiredExports) {
    assert(exports.has(name), `Packaged ${label} WasmX module is missing export: ${name}`);
  }
  return imports.length;
}

async function verifyResource(base, resource, label) {
  assert(resource && typeof resource === "object", `Missing ${label} resource`);
  assert(typeof resource.path === "string", `Missing ${label} path`);
  assert(isSafeRelativePath(resource.path), `Unsafe ${label} path`);
  assert(
    typeof resource.sha256 === "string" && /^[0-9a-f]{64}$/.test(resource.sha256),
    `Invalid ${label} SHA-256`,
  );
  const bytes = await readFile(join(base, resource.path));
  assert(digest(bytes) === resource.sha256, `${label} SHA-256 mismatch`);
  return bytes;
}

function isSafeRelativePath(value) {
  return !isAbsolute(value)
    && !value.includes("\\")
    && value.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
