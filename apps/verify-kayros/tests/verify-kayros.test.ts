import { describe, expect, it, vi } from "vitest";

import type { KayrosHashRecord } from "@provable/core";

import {
  buildKayrosRecordHashInput,
  runVerifyKayrosWorkflow,
  toModuleInput,
} from "../src/index";

const RECORD: KayrosHashRecord = {
  block: 1151,
  dataItem: "04b78883e395b678add9dd89da97d3e2840cd4b9253a7164253b8c9c69145425",
  dataType: "provable_sdk",
  hashItem: "1faece94494562e82b3ddc527798e357188b9db3abf98e555d7a6e324feaf03f",
  hashType: "sha3_256",
  position: 1151,
  prevHash: "159725cc3d317ca86194d94ddae0c728378c06509de199fef76556fa42e119db",
  timestamp: "2026-08-04T11:27:21.220Z",
  timestampId: "7542ccba-8ff7-11f1-8000-fc7400000000",
};

describe("Verify Kayros workflow", () => {
  it("builds the exact 92-byte record-hash input", () => {
    const payload = buildKayrosRecordHashInput(toModuleInput(RECORD));
    expect(payload.byteLength).toBe(92);
    expect(Array.from(payload.slice(32, 44))).toEqual(
      Array.from(new TextEncoder().encode("provable_sdk")),
    );
  });

  it("finds a record by its stored hash and cross-checks WasmX locally", async () => {
    const findByRecordHash = vi.fn(async () => RECORD);
    const expected = {
      computedHash: RECORD.hashItem,
      matches: true,
      inputBytes: 92,
    };
    const run = vi.fn(async () => expected);
    const result = await runVerifyKayrosWorkflow(
      { recordHash: RECORD.hashItem },
      {
        findByRecordHash,
        findByDataItem: vi.fn(async () => []),
        run,
        sha3_256: () => RECORD.hashItem,
      },
    );
    expect(result).toEqual({ status: "verified", record: RECORD, output: expected });
    expect(findByRecordHash).toHaveBeenCalledWith(RECORD.hashItem);
    expect(run).toHaveBeenCalledWith(toModuleInput(RECORD), RECORD);
  });

  it("does not silently choose an ambiguous data-item record", async () => {
    const result = await runVerifyKayrosWorkflow(
      { dataItem: RECORD.dataItem },
      {
        findByRecordHash: vi.fn(async () => undefined),
        findByDataItem: vi.fn(async () => [RECORD, { ...RECORD, block: 1152 }]),
        run: vi.fn(),
        sha3_256: vi.fn(),
      },
    );
    expect(result).toMatchObject({ status: "ambiguous", count: 2 });
  });

  it("requires exactly one lookup value", async () => {
    const dependencies = {
      findByRecordHash: vi.fn(async () => undefined),
      findByDataItem: vi.fn(async () => []),
      run: vi.fn(),
      sha3_256: vi.fn(),
    };
    await expect(runVerifyKayrosWorkflow({}, dependencies)).rejects.toThrow("exactly one");
    await expect(runVerifyKayrosWorkflow({
      recordHash: RECORD.hashItem,
      dataItem: RECORD.dataItem,
    }, dependencies)).rejects.toThrow("exactly one");
  });

  it("rejects a non-genesis record whose previous hash is unavailable", () => {
    const { prevHash: _prevHash, ...incompleteRecord } = RECORD;
    expect(() => toModuleInput(incompleteRecord)).toThrow("missing the previous hash");
  });

  it("rejects a WasmX result that disagrees with Core", async () => {
    await expect(runVerifyKayrosWorkflow(
      { recordHash: RECORD.hashItem },
      {
        findByRecordHash: vi.fn(async () => RECORD),
        findByDataItem: vi.fn(async () => []),
        run: vi.fn(async () => ({ computedHash: "00".repeat(32), matches: false, inputBytes: 92 })),
        sha3_256: () => RECORD.hashItem,
      },
    )).rejects.toThrow("did not match");
  });
});
