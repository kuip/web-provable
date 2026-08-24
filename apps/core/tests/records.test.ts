import { describe, expect, it, vi } from "vitest";

import {
  MemoryLocalRecordStore,
  WasmXRuntimeError,
  canonicalJson,
  createDiagnosticRecord,
  executeAndRecord,
  isLocalRecordV1,
  isProofActionEligible,
  kayrosSourceVerification,
  sha256Hex,
  verifyLocalRecordDigest,
  type AppBuildIdentityV1,
  type AppExecutor,
  type KayrosHashRecord,
  type JsonValue,
  type RecordHost,
} from "@provable/core";

const APP: AppBuildIdentityV1 = {
  appId: "fixture",
  appVersion: "1.2.3",
  publisher: "github:kuip",
  abi: "provable:app/1",
  manifestSha256: "11".repeat(32),
  moduleSha256: "22".repeat(32),
  uiSha256: "33".repeat(32),
  coreVersion: "0.1.0",
  coreModuleSha256: "44".repeat(32),
};

const KAYROS_RECORD: KayrosHashRecord = {
  block: 7,
  dataItem: "55".repeat(32),
  dataType: "provable_sdk",
  hashItem: "66".repeat(32),
  hashType: "sha3_256",
  position: 7,
  prevHash: "77".repeat(32),
  timestamp: "2026-08-04T11:27:21.220Z",
  timestampId: "7542ccba-8ff7-11f1-8000-fc7400000000",
};

describe("local record contracts", () => {
  it("creates deterministic digest-only diagnostic records that can never be proof eligible", async () => {
    const options = {
      app: APP,
      input: { b: "fish", a: "one fish" },
      stage: "source-not-found" as const,
      error: { code: "kayros-source-not-found", message: "Not found" },
      capabilitiesUsed: ["kayros:read", "kayros:read"],
    };
    const left = await createDiagnosticRecord({ ...options, host: fixedHost() });
    const right = await createDiagnosticRecord({ ...options, host: fixedHost() });

    expect(left).toEqual(right);
    expect(left.input).not.toHaveProperty("value");
    expect(left.capabilitiesUsed).toEqual(["kayros:read"]);
    expect(isProofActionEligible(left)).toBe(false);
    await expect(verifyLocalRecordDigest(left)).resolves.toBe(true);
  });

  it("records successful execution with canonical inputs, outputs, and conservative eligibility", async () => {
    const store = new MemoryLocalRecordStore();
    const executor: AppExecutor<{ z: number; a: number }, { ok: boolean }> = {
      run: vi.fn(async () => ({ ok: true })),
    };
    const source = kayrosSourceVerification(KAYROS_RECORD, {
      apiBaseUrl: "https://kayros.example",
      locallyVerified: true,
      verificationMethod: "database-match",
    });

    const result = await executeAndRecord(executor, { z: 2, a: 1 }, {
      app: APP,
      records: store,
      capabilitiesUsed: ["kayros:read"],
      sourceVerification: source,
      host: advancingHost(),
    });

    expect(result.output).toEqual({ ok: true });
    expect(result.record.status).toBe("succeeded");
    expect(result.record.input.value).toEqual({ a: 1, z: 2 });
    expect(result.record.output?.value).toEqual({ ok: true });
    expect(result.record.proofEligibility).toEqual({
      eligible: false,
      reasons: ["source-unanchored"],
    });
    expect(result.persistenceError).toBeUndefined();
    await expect(store.list()).resolves.toEqual([result.record]);
  });

  it("allows proof actions only for successful, schema-valid, trusted source verification", async () => {
    const result = await executeAndRecord(
      { run: async () => ({ ok: true }) },
      { input: true },
      {
        app: APP,
        records: new MemoryLocalRecordStore(),
        sourceVerification: kayrosSourceVerification(KAYROS_RECORD, {
          apiBaseUrl: "https://kayros.example",
          locallyVerified: true,
          trustAnchored: true,
          verificationMethod: "trusted-root-proof",
        }),
        host: advancingHost(),
      },
    );

    expect(result.record.proofEligibility).toEqual({ eligible: true, reasons: [] });
    expect(isProofActionEligible(result.record)).toBe(true);
  });

  it.each([
    ["failed", new WasmXRuntimeError("execution-failed", "fixture failed")],
    ["cancelled", new WasmXRuntimeError("aborted", "fixture cancelled")],
  ] as const)("persists a %s record and rethrows the invocation error", async (status, failure) => {
    const store = new MemoryLocalRecordStore();
    const executor: AppExecutor<{ input: boolean }, never> = {
      run: vi.fn(async () => { throw failure; }),
    };

    await expect(executeAndRecord(executor, { input: true }, {
      app: APP,
      records: store,
      host: advancingHost(),
    })).rejects.toBe(failure);

    const [record] = await store.list();
    expect(record?.kind).toBe("execution");
    if (record?.kind === "execution") {
      expect(record.status).toBe(status);
      expect(record.proofEligibility.eligible).toBe(false);
      expect(record.error?.code).toBe(failure.code);
    }
  });

  it("records post-invocation output processing failures", async () => {
    const store = new MemoryLocalRecordStore();
    const failure = new Error("source verifier failed");

    await expect(executeAndRecord(
      { run: async () => ({ ok: true }) },
      { input: true },
      {
        app: APP,
        records: store,
        host: advancingHost(),
        sourceVerificationFromOutput: () => { throw failure; },
      },
    )).rejects.toBe(failure);

    const [record] = await store.list();
    expect(record?.kind).toBe("execution");
    if (record?.kind === "execution") {
      expect(record.status).toBe("failed");
      expect(record.outputSchemaValid).toBe(true);
      expect(record.output?.value).toEqual({ ok: true });
    }
  });

  it("does not hide a successful execution when local persistence fails", async () => {
    const onRecord = vi.fn();
    const result = await executeAndRecord(
      { run: async () => ({ ok: true }) },
      { input: true },
      {
        app: APP,
        records: { put: async () => { throw new Error("storage unavailable"); } },
        host: advancingHost(),
        onRecord,
      },
    );

    expect(result.output).toEqual({ ok: true });
    expect(result.persistenceError?.message).toBe("storage unavailable");
    expect(onRecord).toHaveBeenCalledWith(result.record, result.persistenceError);
  });

  it("rejects tampered records and orders valid records newest first", async () => {
    const store = new MemoryLocalRecordStore();
    const older = await createDiagnosticRecord({
      app: APP,
      input: { value: "older" },
      stage: "source-not-found",
      error: { code: "missing", message: "Missing" },
      host: fixedHost("2026-08-01T00:00:00.000Z", "older"),
    });
    const newer = await createDiagnosticRecord({
      app: APP,
      input: { value: "newer" },
      stage: "source-not-found",
      error: { code: "missing", message: "Missing" },
      host: fixedHost("2026-08-02T00:00:00.000Z", "newer"),
    });
    await store.put(older);
    await store.put(newer);

    await expect(store.list()).resolves.toEqual([newer, older]);
    await expect(store.put(newer)).rejects.toThrow("already exists");
    await expect(store.put({ ...newer, stage: "integrity" })).rejects.toThrow(
      "invalid digest",
    );
    expect(isLocalRecordV1({ ...newer, unexpected: true })).toBe(false);
  });

  it("rejects a recomputed outer digest when a nested execution digest is false", async () => {
    const execution = await executeAndRecord(
      { run: async () => ({ ok: true }) },
      { input: true },
      {
        app: APP,
        records: new MemoryLocalRecordStore(),
        host: advancingHost(),
      },
    );
    const tampered = {
      ...execution.record,
      input: { ...execution.record.input, sha256: "ff".repeat(32) },
    };
    const { recordSha256: _recordSha256, ...body } = tampered;
    tampered.recordSha256 = await sha256Hex(
      canonicalJson(body as unknown as JsonValue),
    );

    expect(isLocalRecordV1(tampered)).toBe(true);
    await expect(verifyLocalRecordDigest(tampered)).resolves.toBe(false);
    await expect(new MemoryLocalRecordStore().put(tampered)).rejects.toThrow(
      "invalid digest",
    );
  });
});

function fixedHost(
  iso = "2026-08-01T00:00:00.000Z",
  id = "00000000-0000-4000-8000-000000000001",
): RecordHost {
  return { now: () => new Date(iso), randomUUID: () => id };
}

function advancingHost(): RecordHost {
  const timestamps = [
    "2026-08-01T00:00:00.000Z",
    "2026-08-01T00:00:01.000Z",
  ];
  let index = 0;
  return {
    now: () => new Date(timestamps[Math.min(index++, timestamps.length - 1)]!),
    randomUUID: () => "00000000-0000-4000-8000-000000000002",
  };
}
