import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, "dist/chrome");
const chromeSource = join(root, "extension/chrome");
const appSource = join(root, "apps/prove-inclusion");
const profile = process.argv.find((argument) => argument.startsWith("--profile="))?.split("=")[1]
  ?? "development";
if (profile !== "development" && profile !== "store") {
  throw new Error(`Unsupported Chrome build profile: ${profile}`);
}
const wasmSource = join(
  root,
  "target/wasm32-unknown-unknown/release/prove_inclusion_wasmx.wasm",
);
const coreWasmSource = join(
  root,
  "target/wasm32-unknown-unknown/release/provable_wasmx_core.wasm",
);

await rm(output, { recursive: true, force: true });
await mkdir(join(output, "icons"), { recursive: true });
await mkdir(join(output, "apps/core"), { recursive: true });
await mkdir(join(output, "apps/prove-inclusion"), { recursive: true });

await Promise.all([
  build({
    entryPoints: [join(chromeSource, "src/background.ts")],
    outfile: join(output, "background.js"),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "chrome114",
    sourcemap: false,
  }),
  build({
    entryPoints: [join(chromeSource, "src/panel.ts")],
    outfile: join(output, "panel.js"),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "chrome114",
    sourcemap: false,
  }),
  cp(join(chromeSource, "manifest.json"), join(output, "manifest.json")),
  cp(join(chromeSource, "panel.html"), join(output, "panel.html")),
  cp(join(chromeSource, "styles.css"), join(output, "styles.css")),
  cp(join(root, "static/image/logo.png"), join(output, "icons/logo.png")),
  cp(coreWasmSource, join(output, "apps/core/core.wasm")),
  cp(join(appSource, "ui.md"), join(output, "apps/prove-inclusion/ui.md")),
  cp(wasmSource, join(output, "apps/prove-inclusion/app.wasm")),
]);

const [wasmBytes, coreWasmBytes, uiBytes, sourceManifestText, coreManifestText] = await Promise.all([
  readFile(wasmSource),
  readFile(coreWasmSource),
  readFile(join(appSource, "ui.md")),
  readFile(join(appSource, "app.config.json"), "utf8"),
  readFile(join(root, "apps/core/app.json"), "utf8"),
]);
const sourceManifest = JSON.parse(sourceManifestText);
const releaseManifest = {
  ...sourceManifest,
  module: {
    ...sourceManifest.module,
    sha256: digest(wasmBytes),
  },
  ui: {
    ...sourceManifest.ui,
    sha256: digest(uiBytes),
  },
};
await writeFile(
  join(output, "apps/prove-inclusion/app.json"),
  `${JSON.stringify(releaseManifest, null, 2)}\n`,
);

const coreSourceManifest = JSON.parse(coreManifestText);
const coreReleaseManifest = {
  ...coreSourceManifest,
  module: {
    ...coreSourceManifest.module,
    sha256: digest(coreWasmBytes),
  },
};
await writeFile(
  join(output, "apps/core/app.json"),
  `${JSON.stringify(coreReleaseManifest, null, 2)}\n`,
);

const localEnvironment = profile === "development"
  ? await readEnvironment(join(root, ".env"))
  : {};
const runtimeConfig = {
  schemaVersion: 1,
  profile,
  kayros: {
    apiBaseUrl: localEnvironment.KAYROS_API_BASE_URL ?? "https://kayros.provable.dev",
    dashboardUrl: localEnvironment.KAYROS_DASHBOARD_URL ?? "https://dashboard.kayros.provable.dev/",
    apiKey: localEnvironment.KAYROS_API_KEY ?? "",
    dataType: "provable_sdk",
    table: "s32_hashes",
  },
};
await writeFile(
  join(output, "config.json"),
  `${JSON.stringify(runtimeConfig, null, 2)}\n`,
);

console.log(`Built Chrome extension at ${output}`);
console.log(`Prove Inclusion WasmX SHA-256: ${releaseManifest.module.sha256}`);
console.log(`Core WasmX SHA-256: ${coreReleaseManifest.module.sha256}`);
if (runtimeConfig.kayros.apiKey.length > 0) {
  console.log("Included the ignored local Kayros key in the development artifact only");
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function readEnvironment(path) {
  let contents;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }

  const values = {};
  for (const sourceLine of contents.split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
    values[key] = value;
  }
  return values;
}
