import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { WasmXModule } from "@web-provable/core";
import {
  computeProveInclusion,
  type ProveInclusionInput,
  type ProveInclusionOutput,
} from "../src/index";

const wasmUrl = new URL(
  "../../../target/wasm32-unknown-unknown/release/prove_inclusion_wasmx.wasm",
  import.meta.url,
);

describe("Prove Inclusion WasmX module", () => {
  it("matches the TypeScript reference implementation", async () => {
    const bytes = new Uint8Array(await readFile(wasmUrl));
    const module = await WasmXModule.instantiate<ProveInclusionInput, ProveInclusionOutput>(bytes);
    const input = { a: "one fish two fish red fish blue fish", b: "fish", n: 3 };
    await expect(module.run(input)).resolves.toEqual(computeProveInclusion(input));
  });

  it("returns a structured error for invalid input", async () => {
    const bytes = new Uint8Array(await readFile(wasmUrl));
    const module = await WasmXModule.instantiate<ProveInclusionInput, ProveInclusionOutput>(bytes);
    await expect(module.run({ a: "abc", b: "", n: 0 })).rejects.toThrow(
      "Text B must not be empty",
    );
  });
});

