import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, "target/test/wasmx-worker.mjs");

await mkdir(dirname(output), { recursive: true });
await build({
  entryPoints: [join(root, "apps/core/src/wasmx-worker.ts")],
  outfile: output,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  sourcemap: false,
});

