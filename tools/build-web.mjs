import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, "dist/web");
const webSource = join(root, "web");
const appSource = join(root, "apps/prove-inclusion");
const appWasmSource = join(
  root,
  "target/wasm32-unknown-unknown/release/prove_inclusion_wasmx.wasm",
);
const coreWasmSource = join(
  root,
  "target/wasm32-unknown-unknown/release/provable_wasmx_core.wasm",
);

await rm(output, { recursive: true, force: true });
await Promise.all([
  mkdir(join(output, "assets"), { recursive: true }),
  mkdir(join(output, "icons"), { recursive: true }),
  mkdir(join(output, "apps/core"), { recursive: true }),
  mkdir(join(output, "apps/prove-inclusion"), { recursive: true }),
]);

await Promise.all([
  build({
    entryPoints: [join(webSource, "src/main.ts")],
    outfile: join(output, "assets/app.js"),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["chrome114", "firefox115", "safari16.4"],
    sourcemap: false,
  }),
  cp(join(webSource, "index.html"), join(output, "index.html")),
  cp(join(webSource, "index.html"), join(output, "404.html")),
  cp(join(webSource, "styles.css"), join(output, "styles.css")),
  cp(join(root, "static/image/logo.png"), join(output, "icons/logo.png")),
  cp(coreWasmSource, join(output, "apps/core/core.wasm")),
  cp(join(appSource, "ui.md"), join(output, "apps/prove-inclusion/ui.md")),
  cp(appWasmSource, join(output, "apps/prove-inclusion/app.wasm")),
  writeFile(join(output, ".nojekyll"), ""),
]);

const [appWasmBytes, coreWasmBytes, uiBytes, appManifestText, coreManifestText] =
  await Promise.all([
    readFile(appWasmSource),
    readFile(coreWasmSource),
    readFile(join(appSource, "ui.md")),
    readFile(join(appSource, "app.config.json"), "utf8"),
    readFile(join(root, "apps/core/app.json"), "utf8"),
  ]);

const appManifest = JSON.parse(appManifestText);
const appReleaseManifest = {
  ...appManifest,
  module: {
    ...appManifest.module,
    sha256: digest(appWasmBytes),
  },
  ui: {
    ...appManifest.ui,
    sha256: digest(uiBytes),
  },
};
await writeJson(join(output, "apps/prove-inclusion/app.json"), appReleaseManifest);

const coreManifest = JSON.parse(coreManifestText);
const coreReleaseManifest = {
  ...coreManifest,
  module: {
    ...coreManifest.module,
    sha256: digest(coreWasmBytes),
  },
};
await writeJson(join(output, "apps/core/app.json"), coreReleaseManifest);

const runtimeConfig = {
  schemaVersion: 1,
  profile: "web",
  kayros: {
    apiBaseUrl: "https://kayros.provable.dev",
    dashboardUrl: "https://dashboard.kayros.provable.dev/",
    dataType: "provable_sdk",
    table: "s32_hashes",
  },
};
await writeJson(join(output, "config.json"), runtimeConfig);

console.log(`Built GitHub Pages site at ${output}`);
console.log(`Prove Inclusion WasmX SHA-256: ${appReleaseManifest.module.sha256}`);
console.log(`Core WasmX SHA-256: ${coreReleaseManifest.module.sha256}`);

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
