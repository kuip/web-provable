export type AppJsonSchema =
  | AppJsonObjectSchema
  | AppJsonArraySchema
  | AppJsonStringSchema
  | AppJsonIntegerSchema
  | AppJsonNumberSchema
  | AppJsonBooleanSchema
  | AppJsonNullSchema;

export interface AppJsonObjectSchema {
  type: "object";
  properties: Record<string, AppJsonSchema>;
  required?: string[];
  additionalProperties: false;
}

export interface AppJsonArraySchema {
  type: "array";
  items: AppJsonSchema;
  minItems?: number;
  maxItems?: number;
}

export interface AppJsonStringSchema {
  type: "string";
  minLength?: number;
  maxLength?: number;
}

export interface AppJsonIntegerSchema {
  type: "integer";
  minimum?: number;
  maximum?: number;
}

export interface AppJsonNumberSchema {
  type: "number";
  minimum?: number;
  maximum?: number;
}

export interface AppJsonBooleanSchema {
  type: "boolean";
}

export interface AppJsonNullSchema {
  type: "null";
}

export interface AppJsonSchemaIssue {
  path: string;
  message: string;
}

const MAX_SCHEMA_DEPTH = 12;
const MAX_SCHEMA_NODES = 256;
const MAX_OBJECT_PROPERTIES = 128;
const MAX_COLLECTION_ITEMS = 1_000_000;

/** Validates the frozen, no-reference JSON Schema subset supported by WasmX ABI 1. */
export function assertAppJsonSchema(
  value: unknown,
  label = "schema",
): asserts value is AppJsonSchema {
  assertSchemaNode(value, label, 0, { nodes: 0 });
}

/** Returns the first deterministic validation issue, or undefined when the value conforms. */
export function findAppJsonSchemaIssue(
  schema: AppJsonSchema,
  value: unknown,
  path = "$",
): AppJsonSchemaIssue | undefined {
  switch (schema.type) {
    case "null":
      return value === null ? undefined : issue(path, "must be null");
    case "boolean":
      return typeof value === "boolean" ? undefined : issue(path, "must be a boolean");
    case "string": {
      if (typeof value !== "string") {
        return issue(path, "must be a string");
      }
      const length = unicodeLength(value);
      if (schema.minLength !== undefined && length < schema.minLength) {
        return issue(path, `must contain at least ${schema.minLength} characters`);
      }
      if (schema.maxLength !== undefined && length > schema.maxLength) {
        return issue(path, `must contain at most ${schema.maxLength} characters`);
      }
      return undefined;
    }
    case "integer":
      if (!Number.isSafeInteger(value)) {
        return issue(path, "must be a safe integer");
      }
      return findNumberRangeIssue(schema, value as number, path);
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return issue(path, "must be a finite number");
      }
      return findNumberRangeIssue(schema, value, path);
    case "array": {
      if (!Array.isArray(value)) {
        return issue(path, "must be an array");
      }
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        return issue(path, `must contain at least ${schema.minItems} items`);
      }
      if (schema.maxItems !== undefined && value.length > schema.maxItems) {
        return issue(path, `must contain at most ${schema.maxItems} items`);
      }
      for (let index = 0; index < value.length; index += 1) {
        const itemIssue = findAppJsonSchemaIssue(schema.items, value[index], `${path}[${index}]`);
        if (itemIssue) {
          return itemIssue;
        }
      }
      return undefined;
    }
    case "object": {
      if (!isRecord(value)) {
        return issue(path, "must be an object");
      }
      for (const property of schema.required ?? []) {
        if (!Object.hasOwn(value, property)) {
          return issue(propertyPath(path, property), "is required");
        }
      }
      for (const property of Object.keys(value).sort()) {
        const propertySchema = Object.hasOwn(schema.properties, property)
          ? schema.properties[property]
          : undefined;
        if (!propertySchema) {
          return issue(propertyPath(path, property), "is not an allowed property");
        }
        const propertyIssue = findAppJsonSchemaIssue(
          propertySchema,
          value[property],
          propertyPath(path, property),
        );
        if (propertyIssue) {
          return propertyIssue;
        }
      }
      return undefined;
    }
  }
}

function assertSchemaNode(
  value: unknown,
  label: string,
  depth: number,
  state: { nodes: number },
): void {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error(`${label} must be a supported JSON Schema object`);
  }
  state.nodes += 1;
  if (depth > MAX_SCHEMA_DEPTH || state.nodes > MAX_SCHEMA_NODES) {
    throw new Error(`${label} exceeds the JSON Schema complexity limit`);
  }

  switch (value.type) {
    case "null":
    case "boolean":
      assertKnownKeys(value, ["type"], label);
      return;
    case "string":
      assertKnownKeys(value, ["type", "minLength", "maxLength"], label);
      assertOptionalBound(value.minLength, `${label}.minLength`, MAX_COLLECTION_ITEMS);
      assertOptionalBound(value.maxLength, `${label}.maxLength`, MAX_COLLECTION_ITEMS);
      assertOrderedBounds(value.minLength, value.maxLength, label);
      return;
    case "integer":
    case "number":
      assertKnownKeys(value, ["type", "minimum", "maximum"], label);
      assertOptionalFiniteNumber(value.minimum, `${label}.minimum`);
      assertOptionalFiniteNumber(value.maximum, `${label}.maximum`);
      if (value.type === "integer") {
        assertOptionalSafeInteger(value.minimum, `${label}.minimum`);
        assertOptionalSafeInteger(value.maximum, `${label}.maximum`);
      }
      assertOrderedBounds(value.minimum, value.maximum, label);
      return;
    case "array":
      assertKnownKeys(value, ["type", "items", "minItems", "maxItems"], label);
      assertOptionalBound(value.minItems, `${label}.minItems`, MAX_COLLECTION_ITEMS);
      assertOptionalBound(value.maxItems, `${label}.maxItems`, MAX_COLLECTION_ITEMS);
      assertOrderedBounds(value.minItems, value.maxItems, label);
      assertSchemaNode(value.items, `${label}.items`, depth + 1, state);
      return;
    case "object": {
      assertKnownKeys(
        value,
        ["type", "properties", "required", "additionalProperties"],
        label,
      );
      if (!isRecord(value.properties)) {
        throw new Error(`${label}.properties must be an object`);
      }
      if (value.additionalProperties !== false) {
        throw new Error(`${label}.additionalProperties must be false`);
      }
      const propertyNames = Object.keys(value.properties);
      if (propertyNames.length > MAX_OBJECT_PROPERTIES) {
        throw new Error(`${label} has too many properties`);
      }
      for (const property of propertyNames.sort()) {
        if (property.length === 0 || property.length > 128) {
          throw new Error(`${label} has an invalid property name`);
        }
        assertSchemaNode(
          value.properties[property],
          `${label}.properties.${property}`,
          depth + 1,
          state,
        );
      }
      if (value.required !== undefined) {
        if (!Array.isArray(value.required)) {
          throw new Error(`${label}.required must be an array`);
        }
        const required = new Set<string>();
        for (const property of value.required) {
          if (typeof property !== "string" || !Object.hasOwn(value.properties, property)) {
            throw new Error(`${label}.required contains an unknown property`);
          }
          if (required.has(property)) {
            throw new Error(`${label}.required contains a duplicate property`);
          }
          required.add(property);
        }
      }
      return;
    }
    default:
      throw new Error(`${label} uses unsupported JSON Schema type: ${value.type}`);
  }
}

function findNumberRangeIssue(
  schema: AppJsonIntegerSchema | AppJsonNumberSchema,
  value: number,
  path: string,
): AppJsonSchemaIssue | undefined {
  if (schema.minimum !== undefined && value < schema.minimum) {
    return issue(path, `must be at least ${schema.minimum}`);
  }
  if (schema.maximum !== undefined && value > schema.maximum) {
    return issue(path, `must be at most ${schema.maximum}`);
  }
  return undefined;
}

function assertKnownKeys(
  value: Record<string, unknown>,
  allowed: string[],
  label: string,
): void {
  const allowedKeys = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unknown) {
    throw new Error(`${label} contains unsupported keyword: ${unknown}`);
  }
}

function assertOptionalBound(value: unknown, label: string, maximum: number): void {
  if (
    value !== undefined
    && (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum)
  ) {
    throw new Error(`${label} must be an integer from 0 to ${maximum}`);
  }
}

function assertOptionalFiniteNumber(value: unknown, label: string): void {
  if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) {
    throw new Error(`${label} must be a finite number`);
  }
}

function assertOptionalSafeInteger(value: unknown, label: string): void {
  if (value !== undefined && !Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer`);
  }
}

function assertOrderedBounds(minimum: unknown, maximum: unknown, label: string): void {
  if (
    typeof minimum === "number"
    && typeof maximum === "number"
    && minimum > maximum
  ) {
    throw new Error(`${label} minimum exceeds maximum`);
  }
}

function unicodeLength(value: string): number {
  let length = 0;
  for (const character of value) {
    length += character.length > 0 ? 1 : 0;
  }
  return length;
}

function propertyPath(path: string, property: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(property)
    ? `${path}.${property}`
    : `${path}[${JSON.stringify(property)}]`;
}

function issue(path: string, message: string): AppJsonSchemaIssue {
  return { path, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
