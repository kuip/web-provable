export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const encoder = new TextEncoder();

export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Canonical JSON does not support non-finite numbers");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const entries = Object.entries(value).sort(([left], [right]) => (
    left < right ? -1 : left > right ? 1 : 0
  ));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

export function utf8(value: string): Uint8Array {
  return encoder.encode(value);
}

export async function sha256Hex(value: string | Uint8Array | ArrayBuffer): Promise<string> {
  const bytes = typeof value === "string"
    ? utf8(value)
    : value instanceof Uint8Array
      ? value
      : new Uint8Array(value);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return bytesToHex(new Uint8Array(digest));
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(value: string): Uint8Array {
  const normalized = value.toLowerCase().replace(/^0x/, "");
  if (normalized.length % 2 !== 0 || !/^[0-9a-f]*$/.test(normalized)) {
    throw new Error("Invalid hexadecimal value");
  }
  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < normalized.length; index += 2) {
    bytes[index / 2] = Number.parseInt(normalized.slice(index, index + 2), 16);
  }
  return bytes;
}

export function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}
