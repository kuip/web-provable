import { describe, expect, it, vi } from "vitest";

import {
  computeProveInclusion,
  countNonOverlappingOccurrences,
  runProveInclusionWorkflow,
} from "../src/index";

const notarization = {
  block: 42,
  dataItem: "11".repeat(32),
  dataType: "provable_sdk",
  hashItem: "22".repeat(32),
  hashType: "sha3_256",
  position: 42,
  timestamp: "2026-08-04T11:27:21.220Z",
  timestampId: "7542ccba-8ff7-11f1-8000-fc7400000000",
};

describe("Prove Inclusion reference implementation", () => {
  it("counts non-overlapping matches", () => {
    expect(countNonOverlappingOccurrences("aaaa", "aa")).toBe(2);
  });

  it("handles Unicode text exactly", () => {
    expect(countNonOverlappingOccurrences("é—é—é", "é")).toBe(3);
  });

  it("evaluates N < C", () => {
    expect(computeProveInclusion({ a: "aaaa", b: "aa", n: 1 })).toEqual({
      count: 2,
      result: true,
    });
    expect(computeProveInclusion({ a: "aaaa", b: "aa", n: 2 })).toEqual({
      count: 2,
      result: false,
    });
  });

  it("defaults optional N to zero", () => {
    expect(computeProveInclusion({ a: "abc", b: "b" })).toEqual({
      count: 1,
      result: true,
    });
  });

  it("rejects an empty B", () => {
    expect(() => computeProveInclusion({ a: "anything", b: "", n: 0 })).toThrow(
      "Text B must not be empty",
    );
  });

  it("hashes, verifies notarization, then runs the inclusion module", async () => {
    const calls: string[] = [];
    const run = vi.fn(async () => {
      calls.push("run");
      return { count: 2, result: true };
    });
    const result = await runProveInclusionWorkflow(
      { a: "aaaa", b: "aa", n: 1 },
      {
        sha3_256: () => {
          calls.push("hash");
          return "11".repeat(32);
        },
        findNotarization: async () => {
          calls.push("lookup");
          return notarization;
        },
        run,
      },
    );

    expect(calls).toEqual(["hash", "lookup", "run"]);
    expect(run).toHaveBeenCalledWith(
      { a: "aaaa", b: "aa", n: 1 },
      notarization,
    );
    expect(result).toMatchObject({
      status: "notarized",
      contentHash: "11".repeat(32),
      record: notarization,
      output: { count: 2, result: true },
    });
  });

  it("does not run inclusion when A is not notarized", async () => {
    const run = vi.fn(async () => ({ count: 1, result: true }));
    await expect(runProveInclusionWorkflow(
      { a: "abc", b: "b" },
      {
        sha3_256: () => "11".repeat(32),
        findNotarization: async () => undefined,
        run,
      },
    )).resolves.toEqual({
      status: "not-found",
      contentHash: "11".repeat(32),
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("reports lookup failures without running inclusion", async () => {
    const run = vi.fn(async () => ({ count: 1, result: true }));
    await expect(runProveInclusionWorkflow(
      { a: "abc", b: "b" },
      {
        sha3_256: () => "11".repeat(32),
        findNotarization: async () => {
          throw new Error("offline");
        },
        run,
      },
    )).resolves.toEqual({
      status: "lookup-error",
      contentHash: "11".repeat(32),
      error: "offline",
    });
    expect(run).not.toHaveBeenCalled();
  });
});
