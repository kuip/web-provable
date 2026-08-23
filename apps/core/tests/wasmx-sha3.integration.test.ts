import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { WasmXSha3Module } from "@provable/core";

const wasmUrl = new URL(
  "../../../target/wasm32-unknown-unknown/release/provable_wasmx_core.wasm",
  import.meta.url,
);

describe("core SHA3-256 WasmX module", () => {
  it("matches the FIPS SHA3-256 vectors", async () => {
    const bytes = new Uint8Array(await readFile(wasmUrl));
    const module = await WasmXSha3Module.instantiate(bytes);

    expect(module.sha3_256("")).toBe(
      "a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a",
    );
    expect(module.sha3_256("abc")).toBe(
      "3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532",
    );
  });
});
