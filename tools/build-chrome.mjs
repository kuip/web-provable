import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, "dist/chrome");
const chromeSource = join(root, "extension/chrome");
const proveInclusionSource = join(root, "apps/prove-inclusion");
const verifyKayrosSource = join(root, "apps/verify-kayros");
const profile = process.argv.find((argument) => argument.startsWith("--profile="))?.split("=")[1]
  ?? "development";
if (profile !== "development" && profile !== "store") {
  throw new Error(`Unsupported Chrome build profile: ${profile}`);
}
const googleDriveScopes = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/userinfo.email",
];
const localEnvironment = await readEnvironment(join(root, ".env"));
const googleDriveClientId = normalizeGoogleOAuthClientId(
  process.env.GOOGLE_DRIVE_CHROME_CLIENT_ID
    ?? localEnvironment.GOOGLE_DRIVE_CHROME_CLIENT_ID
    ?? "",
);
const sourceExtensionManifest = JSON.parse(
  await readFile(join(chromeSource, "manifest.json"), "utf8"),
);
const extensionManifest = googleDriveClientId.length > 0
  ? {
      ...sourceExtensionManifest,
      oauth2: {
        client_id: googleDriveClientId,
        scopes: googleDriveScopes,
      },
    }
  : sourceExtensionManifest;
const proveInclusionWasmSource = join(
  root,
  "target/wasm32-unknown-unknown/release/prove_inclusion_wasmx.wasm",
);
const verifyKayrosWasmSource = join(
  root,
  "target/wasm32-unknown-unknown/release/verify_kayros_wasmx.wasm",
);
const coreWasmSource = join(
  root,
  "target/wasm32-unknown-unknown/release/provable_wasmx_core.wasm",
);

await rm(output, { recursive: true, force: true });
await mkdir(join(output, "icons"), { recursive: true });
await mkdir(join(output, "apps/core"), { recursive: true });
await mkdir(join(output, "apps/prove-inclusion"), { recursive: true });
await mkdir(join(output, "apps/verify-kayros"), { recursive: true });

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
  build({
    entryPoints: [join(root, "apps/core/src/wasmx-worker.ts")],
    outfile: join(output, "wasmx-worker.js"),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "chrome114",
    sourcemap: false,
  }),
  writeFile(
    join(output, "manifest.json"),
    `${JSON.stringify(extensionManifest, null, 2)}\n`,
  ),
  cp(join(chromeSource, "panel.html"), join(output, "panel.html")),
  cp(join(chromeSource, "styles.css"), join(output, "styles.css")),
  cp(join(root, "static/image/logo.png"), join(output, "icons/logo.png")),
  cp(coreWasmSource, join(output, "apps/core/core.wasm")),
  cp(join(proveInclusionSource, "ui.md"), join(output, "apps/prove-inclusion/ui.md")),
  cp(proveInclusionWasmSource, join(output, "apps/prove-inclusion/app.wasm")),
  cp(join(verifyKayrosSource, "ui.md"), join(output, "apps/verify-kayros/ui.md")),
  cp(verifyKayrosWasmSource, join(output, "apps/verify-kayros/app.wasm")),
]);

const [
  proveInclusionWasmBytes,
  verifyKayrosWasmBytes,
  coreWasmBytes,
  proveInclusionUiBytes,
  verifyKayrosUiBytes,
  proveInclusionManifestText,
  verifyKayrosManifestText,
  coreManifestText,
] = await Promise.all([
  readFile(proveInclusionWasmSource),
  readFile(verifyKayrosWasmSource),
  readFile(coreWasmSource),
  readFile(join(proveInclusionSource, "ui.md")),
  readFile(join(verifyKayrosSource, "ui.md")),
  readFile(join(proveInclusionSource, "app.config.json"), "utf8"),
  readFile(join(verifyKayrosSource, "app.config.json"), "utf8"),
  readFile(join(root, "apps/core/app.json"), "utf8"),
]);
const proveInclusionRelease = releaseApp(
  JSON.parse(proveInclusionManifestText),
  proveInclusionWasmBytes,
  proveInclusionUiBytes,
);
const verifyKayrosRelease = releaseApp(
  JSON.parse(verifyKayrosManifestText),
  verifyKayrosWasmBytes,
  verifyKayrosUiBytes,
);
await Promise.all([
  writeFile(
    join(output, "apps/prove-inclusion/app.json"),
    `${JSON.stringify(proveInclusionRelease, null, 2)}\n`,
  ),
  writeFile(
    join(output, "apps/verify-kayros/app.json"),
    `${JSON.stringify(verifyKayrosRelease, null, 2)}\n`,
  ),
]);

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

const runtimeConfig = {
  schemaVersion: 1,
  profile,
  kayros: {
    apiBaseUrl: profile === "development"
      ? localEnvironment.KAYROS_API_BASE_URL ?? "https://kayros.provable.dev"
      : "https://kayros.provable.dev",
    dashboardUrl: profile === "development"
      ? localEnvironment.KAYROS_DASHBOARD_URL ?? "https://dashboard.kayros.provable.dev/"
      : "https://dashboard.kayros.provable.dev/",
    apiKey: profile === "development" ? localEnvironment.KAYROS_API_KEY ?? "" : "",
    dataType: "provable_sdk",
    table: "s32_hashes",
  },
  googleDrive: {
    clientId: googleDriveClientId,
  },
};
await writeFile(
  join(output, "config.json"),
  `${JSON.stringify(runtimeConfig, null, 2)}\n`,
);

console.log(`Built Chrome extension at ${output}`);
console.log(`Prove Inclusion WasmX SHA-256: ${proveInclusionRelease.module.sha256}`);
console.log(`Verify Kayros WasmX SHA-256: ${verifyKayrosRelease.module.sha256}`);
console.log(`Core WasmX SHA-256: ${coreReleaseManifest.module.sha256}`);
if (runtimeConfig.kayros.apiKey.length > 0) {
  console.log("Included the ignored local Kayros key in the development artifact only");
}
console.log(
  googleDriveClientId.length > 0
    ? "Configured Chrome Identity for Google Drive"
    : "Google Drive sign-in is disabled until GOOGLE_DRIVE_CHROME_CLIENT_ID is set",
);

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function releaseApp(sourceManifest, wasmBytes, uiBytes) {
  return {
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
}

function normalizeGoogleOAuthClientId(value) {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return "";
  }
  if (
    normalized.length > 255
    || !/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(normalized)
  ) {
    throw new Error("GOOGLE_DRIVE_CHROME_CLIENT_ID must be a Google OAuth client ID");
  }
  return normalized;
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
