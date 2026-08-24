import { describe, expect, it } from "vitest";

import {
  MemoryContentAddressedResourceCache,
  sha256Hex,
  utf8,
} from "../src/index";

describe("content-addressed resource cache", () => {
  it("stores immutable copies under their verified digest", async () => {
    const cache = new MemoryContentAddressedResourceCache();
    const source = utf8("packaged WasmX bytes");
    const digest = await sha256Hex(source);

    await expect(cache.putVerified(digest, source)).resolves.toBe("stored");
    source[0] = 0;
    await expect(cache.count()).resolves.toBe(1);
    await expect(cache.getVerified(digest)).resolves.toEqual(utf8("packaged WasmX bytes"));

    const returned = await cache.getVerified(digest);
    expect(returned).toBeDefined();
    if (returned) {
      returned[0] = 0;
    }
    await expect(cache.getVerified(digest)).resolves.toEqual(utf8("packaged WasmX bytes"));
    await expect(cache.putVerified(digest, utf8("packaged WasmX bytes"))).resolves.toBe(
      "present",
    );
  });

  it("rejects bytes before storage when the claimed digest is wrong", async () => {
    const cache = new MemoryContentAddressedResourceCache();

    await expect(cache.putVerified("00".repeat(32), utf8("tampered"))).rejects.toThrow(
      "mismatched SHA-256",
    );
    await expect(cache.count()).resolves.toBe(0);
  });

  it("rejects malformed content-address keys", async () => {
    const cache = new MemoryContentAddressedResourceCache();

    await expect(cache.getVerified("0x1234")).rejects.toThrow("lowercase SHA-256");
  });
});
