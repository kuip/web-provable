import { describe, expect, it } from "vitest";

import { computeProveInclusion, countNonOverlappingOccurrences } from "../src/index";

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
});
