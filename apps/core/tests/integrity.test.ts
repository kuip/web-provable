import { describe, expect, it } from "vitest";

import { canonicalJson, sha256Hex } from "../src/index";

describe("core integrity", () => {
  it("canonicalizes object keys recursively", () => {
    expect(canonicalJson({ z: 1, a: { y: true, b: null } })).toBe(
      '{"a":{"b":null,"y":true},"z":1}',
    );
    expect(canonicalJson({ ä: 1, z: 2 })).toBe('{"z":2,"ä":1}');
  });

  it("computes a known SHA-256 vector", async () => {
    await expect(sha256Hex("abc")).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
