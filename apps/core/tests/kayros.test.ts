import { afterEach, describe, expect, it, vi } from "vitest";

import {
  findKayrosRecordBySha3,
  getLatestKayrosHash,
  kayrosHashToHex,
  kayrosTimeUuidToIso,
  normalizeKayrosApiKey,
} from "../src/kayros";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Kayros hash encoding", () => {
  it("normalizes hexadecimal and base64 32-byte hashes", () => {
    expect(kayrosHashToHex(`0x${"AB".repeat(32)}`)).toBe("ab".repeat(32));
    expect(kayrosHashToHex("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")).toBe(
      "00".repeat(32),
    );
  });

  it("validates browser-configured API keys", () => {
    const key = `0x${"ab".repeat(32)}`;
    expect(normalizeKayrosApiKey(`  ${key}  `)).toBe(key);
    expect(() => normalizeKayrosApiKey("not-a-key")).toThrow(
      "64 hexadecimal characters",
    );
  });

  it("loads the newest provable_sdk s32_hashes row", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      rows: [{
        data_item: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        data_type: "provable_sdk",
        hash_item: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        hash_type: "sha3_256",
        position: 42,
        ts: "7542ccba-8ff7-11f1-8000-fc7400000000",
      }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getLatestKayrosHash({
      apiKey: "test-key",
      baseUrl: "https://kayros.example",
    })).resolves.toMatchObject({
      dataType: "provable_sdk",
      hashItem: "00".repeat(32),
      block: 42,
      position: 42,
      timestamp: "2026-08-04T11:27:21.220Z",
      timestampId: "7542ccba-8ff7-11f1-8000-fc7400000000",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://kayros.example/api/lightnet/database/browse",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("looks up a core SHA3-256 digest as a Kayros data_item", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      count: 0,
      records: [],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(findKayrosRecordBySha3("00".repeat(32), {
      apiKey: "test-key",
      baseUrl: "https://kayros.example",
    })).resolves.toBeUndefined();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "data_item=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA%3D",
    );
  });

  it("decodes Kayros UUID v1 timestamps", () => {
    expect(kayrosTimeUuidToIso("7542ccba-8ff7-11f1-8000-fc7400000000"))
      .toBe("2026-08-04T11:27:21.220Z");
    expect(() => kayrosTimeUuidToIso("not-a-uuid")).toThrow(
      "invalid timestamp UUID",
    );
  });
});
