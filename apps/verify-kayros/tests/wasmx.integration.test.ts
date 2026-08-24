import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { WasmXModule } from "@provable/core";
import type { VerifyKayrosModuleInput, VerifyKayrosOutput } from "../src/index";

const wasmUrl = new URL(
  "../../../target/wasm32-unknown-unknown/release/verify_kayros_wasmx.wasm",
  import.meta.url,
);

const input: VerifyKayrosModuleInput = {
  previousHash: "159725cc3d317ca86194d94ddae0c728378c06509de199fef76556fa42e119db",
  dataType: "provable_sdk",
  dataItem: "04b78883e395b678add9dd89da97d3e2840cd4b9253a7164253b8c9c69145425",
  timestampId: "7542ccba-8ff7-11f1-8000-fc7400000000",
  hashType: "sha3_256",
  expectedHash: "1faece94494562e82b3ddc527798e357188b9db3abf98e555d7a6e324feaf03f",
};

describe("Verify Kayros WasmX module", () => {
  it("reproduces the stored hash for a real Kayros record", async () => {
    const bytes = new Uint8Array(await readFile(wasmUrl));
    const module = await WasmXModule.instantiate<VerifyKayrosModuleInput, VerifyKayrosOutput>(bytes);
    await expect(module.run(input)).resolves.toEqual({
      computedHash: input.expectedHash,
      matches: true,
      inputBytes: 92,
    });
  });

  it("detects a changed stored hash", async () => {
    const bytes = new Uint8Array(await readFile(wasmUrl));
    const module = await WasmXModule.instantiate<VerifyKayrosModuleInput, VerifyKayrosOutput>(bytes);
    await expect(module.run({ ...input, expectedHash: "00".repeat(32) })).resolves.toMatchObject({
      computedHash: input.expectedHash,
      matches: false,
    });
  });
});
