import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, "dist/web");

const [indexHtml, fallbackHtml, appBundle, styles, noJekyll, logo] = await Promise.all([
  readFile(join(output, "index.html"), "utf8"),
  readFile(join(output, "404.html"), "utf8"),
  readFile(join(output, "assets/app.js")),
  readFile(join(output, "styles.css")),
  readFile(join(output, ".nojekyll")),
  readFile(join(output, "icons/logo.png")),
]);
assert(indexHtml === fallbackHtml, "GitHub Pages fallback must load the same application shell");
assert(appBundle.byteLength > 0, "Web application bundle is empty");
assert(styles.byteLength > 0, "Web stylesheet is empty");
assert(noJekyll.byteLength === 0, ".nojekyll must be empty");
assert(logo.byteLength > 0, "Web logo is empty");
assert(
  indexHtml.includes("script-src 'self' 'wasm-unsafe-eval'"),
  "Web CSP must permit only packaged scripts and local WebAssembly",
);
assert(
  indexHtml.includes('src="./assets/app.js"'),
  "Web application bundle must use a repository-relative URL",
);

const runtimeConfig = await readJson(join(output, "config.json"));
assert(runtimeConfig.schemaVersion === 1, "Unexpected web runtime config version");
assert(runtimeConfig.profile === "web", "Unexpected web runtime config profile");
assert(runtimeConfig.kayros?.table === "s32_hashes", "Unexpected Kayros table");
assert(runtimeConfig.kayros?.dataType === "provable_sdk", "Unexpected Kayros data type");
assert(!("apiKey" in runtimeConfig.kayros), "Web artifact must not contain a Kayros API key");

const appRoot = join(output, "apps/prove-inclusion");
const appManifest = await readJson(join(appRoot, "app.json"));
assert(appManifest.abi === "provable:app/1", "Unexpected app ABI");
const appModuleBytes = await verifyResource(appRoot, appManifest.module, "app module");
await verifyResource(appRoot, appManifest.ui, "app UI");
const appImports = await verifyWasm(appModuleBytes, [
  "memory",
  "provable_abi_version",
  "provable_alloc",
  "provable_dealloc",
  "provable_run",
], "app");

const coreRoot = join(output, "apps/core");
const coreManifest = await readJson(join(coreRoot, "app.json"));
assert(coreManifest.id === "core", "Unexpected Core manifest");
const coreModuleBytes = await verifyResource(coreRoot, coreManifest.module, "Core module");
const coreImports = await verifyWasm(coreModuleBytes, [
  "memory",
  "provable_abi_version",
  "provable_alloc",
  "provable_dealloc",
  "provable_sha3_256",
], "Core");

console.log(`Verified GitHub Pages artifact at ${output}`);
console.log(`WasmX imports: app=${appImports}, core=${coreImports}`);
console.log(`App SHA-256: ${appManifest.module.sha256}`);
console.log(`Core SHA-256: ${coreManifest.module.sha256}`);

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
