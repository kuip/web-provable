import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, "dist/chrome");
const extensionManifest = await readJson(join(output, "manifest.json"));

assert(extensionManifest.manifest_version === 3, "Chrome artifact must use Manifest V3");
assert(extensionManifest.background?.service_worker === "background.js", "Missing local service worker");
assert(extensionManifest.side_panel?.default_path === "panel.html", "Missing local side panel");
assert(
  extensionManifest.content_security_policy?.extension_pages
    === "script-src 'self' 'wasm-unsafe-eval'; object-src 'none'",
  "Unexpected extension-page content security policy",
);

await Promise.all([
  readFile(join(output, extensionManifest.background.service_worker)),
  readFile(join(output, extensionManifest.side_panel.default_path)),
  readFile(join(output, "panel.js")),
  readFile(join(output, "styles.css")),
]);

const appRoot = join(output, "apps/prove-inclusion");
const appManifest = await readJson(join(appRoot, "app.json"));
assert(appManifest.abi === "web-provable:app/1", "Unexpected app ABI");

const moduleBytes = await verifyResource(appRoot, appManifest.module, "module");
await verifyResource(appRoot, appManifest.ui, "UI");

const wasmModule = await WebAssembly.compile(moduleBytes);
const imports = WebAssembly.Module.imports(wasmModule);
assert(
  imports.length === 0,
  `Packaged WasmX module has forbidden imports: ${imports
    .map((item) => `${item.module}.${item.name}`)
    .join(", ")}`,
);

const exports = new Set(WebAssembly.Module.exports(wasmModule).map((item) => item.name));
for (const name of [
  "memory",
  "web_provable_abi_version",
  "web_provable_alloc",
  "web_provable_dealloc",
  "web_provable_run",
]) {
  assert(exports.has(name), `Packaged WasmX module is missing export: ${name}`);
}

console.log(`Verified Chrome artifact at ${output}`);
console.log(`WasmX imports: ${imports.length}; module SHA-256: ${appManifest.module.sha256}`);

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
