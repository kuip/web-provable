import { describe, expect, it } from "vitest";

import {
  assertAppJsonSchema,
  findAppJsonSchemaIssue,
  type AppJsonSchema,
} from "../src/index";

const schema: AppJsonSchema = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 1, maxLength: 8 },
    count: { type: "integer", minimum: 0, maximum: 10 },
    flags: {
      type: "array",
      items: { type: "boolean" },
      maxItems: 2,
    },
  },
  required: ["name", "count"],
  additionalProperties: false,
};

describe("Core app JSON Schema subset", () => {
  it("accepts supported schemas and matching values", () => {
    expect(() => assertAppJsonSchema(schema)).not.toThrow();
    expect(findAppJsonSchemaIssue(schema, {
      name: "Kayros",
      count: 2,
      flags: [true, false],
    })).toBeUndefined();
  });

  it("returns deterministic property paths for value failures", () => {
    expect(findAppJsonSchemaIssue(schema, { name: "Kayros", count: -1 })).toEqual({
      path: "$.count",
      message: "must be at least 0",
    });
    expect(findAppJsonSchemaIssue(schema, { name: "Kayros", count: 1, extra: true })).toEqual({
      path: "$.extra",
      message: "is not an allowed property",
    });
  });

  it("rejects unsupported keywords and open object schemas", () => {
    expect(() => assertAppJsonSchema({
      type: "string",
      pattern: ".*",
    })).toThrow("unsupported keyword: pattern");
    expect(() => assertAppJsonSchema({
      type: "object",
      properties: {},
      additionalProperties: true,
    })).toThrow("additionalProperties must be false");
    expect(() => assertAppJsonSchema({
      type: "object",
      properties: {},
      required: ["toString"],
      additionalProperties: false,
    })).toThrow("required contains an unknown property");
  });

  it("treats JSON integers outside the safe range as invalid", () => {
    expect(findAppJsonSchemaIssue({ type: "integer" }, Number.MAX_SAFE_INTEGER + 1)).toEqual({
      path: "$",
      message: "must be a safe integer",
    });
  });
});
