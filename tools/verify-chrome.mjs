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
  extensionManifest.permissions.includes("identity"),
  "Chrome artifact must use the packaged Identity API for Google Drive",
);
assert(
  extensionManifest.host_permissions?.includes("https://openidconnect.googleapis.com/*")
    && extensionManifest.host_permissions.includes("https://www.googleapis.com/*"),
  "Chrome artifact is missing the Google account or Drive API origin",
);
assert(
  !JSON.stringify(extensionManifest).toLowerCase().includes("client_secret"),
  "Chrome artifact must never contain a Google OAuth client secret",
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
const [panelHtml, panelBundle] = await Promise.all([
  readFile(join(output, "panel.html"), "utf8"),
  readFile(join(output, "panel.js"), "utf8"),
]);
assert(panelHtml.includes('id="local-record-list"'), "Missing local record history UI");
assert(panelHtml.includes('id="prove-record-status"'), "Missing Prove Inclusion record status");
assert(panelHtml.includes('id="verify-kayros-record-status"'), "Missing Verify Kayros record status");
assert(panelHtml.includes('id="publisher-trust"'), "Missing bundled publisher provenance UI");
assert(panelHtml.includes('id="manifest-digest"'), "Missing app manifest digest UI");
assert(panelHtml.includes('id="closure-digest"'), "Missing execution closure digest UI");
assert(panelHtml.includes('id="resource-cache-status"'), "Missing verified cache status UI");
assert(panelHtml.includes('id="connect-google-drive"'), "Missing Google Drive connect button");
assert(panelHtml.includes('id="google-drive-account"'), "Missing connected Google account UI");
assert(panelBundle.includes("provable-local-records"), "Missing Core IndexedDB record store");
assert(panelBundle.includes("provable-resource-cache"), "Missing content-addressed resource cache");
assert(panelBundle.includes("publisher signature not configured"), "Missing conservative signature status");
assert(panelBundle.includes("must resolve inside the packaged bundle"), "Missing bundle URL boundary");
assert(panelBundle.includes("Chrome extension bundle root must use chrome-extension:"), "Missing Chrome bundle scheme boundary");
assert(panelBundle.includes("proof ineligible"), "Missing conservative proof eligibility UI");
assert(panelBundle.includes("https://www.googleapis.com/auth/drive.file"), "Missing narrow Google Drive scope");
assert(panelBundle.includes("https://www.googleapis.com/auth/userinfo.email"), "Missing Google email scope");
assert(panelBundle.includes("clearAllCachedAuthTokens"), "Missing Google Drive disconnect behavior");

const runtimeConfig = await readJson(join(output, "config.json"));
assert(runtimeConfig.schemaVersion === 1, "Unexpected runtime config version");
assert(
  runtimeConfig.profile === "development" || runtimeConfig.profile === "store",
  "Unexpected runtime config profile",
);
if (runtimeConfig.profile === "store") {
  assert(runtimeConfig.kayros?.apiKey === "", "Store artifact must not contain a Kayros API key");
}
assert(typeof runtimeConfig.googleDrive?.clientId === "string", "Missing Google Drive runtime config");
if (runtimeConfig.googleDrive.clientId.length > 0) {
  assert(
    extensionManifest.oauth2?.client_id === runtimeConfig.googleDrive.clientId,
    "Google Drive client ID must match the extension manifest",
  );
  assert(
    extensionManifest.oauth2.scopes?.includes("https://www.googleapis.com/auth/drive.file")
      && extensionManifest.oauth2.scopes.includes("https://www.googleapis.com/auth/userinfo.email"),
    "Extension OAuth config must request Drive file and email scopes",
  );
} else {
  assert(extensionManifest.oauth2 === undefined, "Unconfigured builds must omit OAuth metadata");
}

const appVerifications = await Promise.all([
  verifyApp("prove-inclusion", "Prove Inclusion"),
  verifyApp("verify-kayros", "Verify Kayros"),
]);

const coreRoot = join(output, "apps/core");
const coreManifest = await readJson(join(coreRoot, "app.json"));
assertExactKeys(coreManifest, [
  "schemaVersion",
  "id",
  "kind",
  "version",
  "title",
  "description",
  "provides",
  "module",
], "Core manifest");
assertExactKeys(coreManifest.provides, ["typescript", "wasmx", "wasmxAbi"], "Core provides");
assert(coreManifest.provides.wasmxAbi === "provable:app/1", "Unexpected Core WasmX ABI");
assertExactKeys(coreManifest.module, ["path", "sha256"], "Core module resource");
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
  assertExactKeys(manifest, [
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
  ], `${title} manifest`);
  assertExactKeys(manifest.module, ["path", "sha256"], `${title} module resource`);
  assertExactKeys(manifest.ui, ["path", "sha256"], `${title} UI resource`);
  assert(manifest.id === id, `Unexpected ${title} app id`);
  assert(manifest.publisher === "github:kuip", `Unexpected ${title} publisher`);
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

function assertExactKeys(value, expected, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  assert(
    actual.length === wanted.length && actual.every((key, index) => key === wanted[index]),
    `${label} has unexpected fields`,
  );
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
