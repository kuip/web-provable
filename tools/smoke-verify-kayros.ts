import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  findKayrosRecordByHash,
  getLatestKayrosHash,
  WasmXModule,
  WasmXSha3Module,
  type KayrosConnectionOptions,
} from "@provable/core";
import {
  runVerifyKayrosWorkflow,
  type VerifyKayrosModuleInput,
  type VerifyKayrosOutput,
} from "@provable/verify-kayros";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const environment = await readEnvironment(join(root, ".env"));
const apiKey = environment.KAYROS_API_KEY ?? "";
if (apiKey.length === 0) {
  throw new Error("KAYROS_API_KEY is required in .env for the live smoke test");
}

const connection: KayrosConnectionOptions = {
  apiKey,
  baseUrl: environment.KAYROS_API_BASE_URL ?? "https://kayros.provable.dev",
};
const [appBytes, coreBytes, latest] = await Promise.all([
  readFile(join(root, "target/wasm32-unknown-unknown/release/verify_kayros_wasmx.wasm")),
  readFile(join(root, "target/wasm32-unknown-unknown/release/provable_wasmx_core.wasm")),
  getLatestKayrosHash(connection),
]);
const [runner, sha3] = await Promise.all([
  WasmXModule.instantiate<VerifyKayrosModuleInput, VerifyKayrosOutput>(appBytes),
  WasmXSha3Module.instantiate(coreBytes),
]);

const result = await runVerifyKayrosWorkflow(
  { recordHash: latest.hashItem },
  {
    findByRecordHash: (recordHash) => findKayrosRecordByHash(recordHash, connection),
    findByDataItem: async () => [],
    run: (input) => runner.run(input),
    sha3_256: (bytes) => sha3.sha3_256(bytes),
  },
);
if (result.status !== "verified" || !result.output.matches) {
  throw new Error(`Latest Kayros record did not verify locally (${result.status})`);
}

console.log("Verified the latest Kayros record locally");
console.log(`Record hash: ${result.record.hashItem}`);
console.log(`Local hash:  ${result.output.computedHash}`);
console.log(`Block / position: ${result.record.block}`);
console.log(`Timestamp: ${result.record.timestamp}`);

async function readEnvironment(path: string): Promise<Record<string, string>> {
  const contents = await readFile(path, "utf8");
  const values: Record<string, string> = {};
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
