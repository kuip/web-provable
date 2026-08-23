import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, "dist/chrome");
const chromeSource = join(root, "extension/chrome");
const appSource = join(root, "apps/prove-inclusion");
const wasmSource = join(
  root,
  "target/wasm32-unknown-unknown/release/prove_inclusion_wasmx.wasm",
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
  cp(join(root, "apps/core/app.json"), join(output, "apps/core/app.json")),
  cp(join(appSource, "ui.md"), join(output, "apps/prove-inclusion/ui.md")),
  cp(wasmSource, join(output, "apps/prove-inclusion/app.wasm")),
]);

const [wasmBytes, uiBytes, sourceManifestText] = await Promise.all([
  readFile(wasmSource),
  readFile(join(appSource, "ui.md")),
  readFile(join(appSource, "app.config.json"), "utf8"),
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

console.log(`Built Chrome extension at ${output}`);
console.log(`Prove Inclusion WasmX SHA-256: ${releaseManifest.module.sha256}`);

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

