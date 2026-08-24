import { equalBytes, sha256Hex } from "./integrity";

export type VerifiedResourceCacheWrite = "stored" | "present";

export interface ContentAddressedResourceCache {
  putVerified(expectedSha256: string, bytes: Uint8Array): Promise<VerifiedResourceCacheWrite>;
  getVerified(expectedSha256: string): Promise<Uint8Array | undefined>;
  count(): Promise<number>;
}

interface StoredVerifiedResource {
  sha256: string;
  byteLength: number;
  bytes: Uint8Array;
}

const DATABASE_VERSION = 1;
const RESOURCE_STORE = "resources";

/** Persistent, immutable cache keyed only by the verified SHA-256 of exact bytes. */
export class IndexedDbContentAddressedResourceCache implements ContentAddressedResourceCache {
  private databasePromise: Promise<IDBDatabase> | undefined;

  constructor(private readonly databaseName = "provable-resource-cache") {}

  async putVerified(
    expectedSha256: string,
    bytes: Uint8Array,
  ): Promise<VerifiedResourceCacheWrite> {
    await assertExpectedDigest(expectedSha256, bytes);
    const database = await this.database();
    const transaction = database.transaction(RESOURCE_STORE, "readwrite");
    const completion = transactionComplete(transaction);
    const store = transaction.objectStore(RESOURCE_STORE);
    const existing = await requestResult(store.get(expectedSha256));
    if (existing !== undefined) {
      await completion;
      await assertStoredResource(existing, expectedSha256);
      return "present";
    }
    store.add({
      sha256: expectedSha256,
      byteLength: bytes.byteLength,
      bytes: copyBytes(bytes),
    } satisfies StoredVerifiedResource);
    await completion;
    return "stored";
  }

  async getVerified(expectedSha256: string): Promise<Uint8Array | undefined> {
    assertDigest(expectedSha256);
    const database = await this.database();
    const transaction = database.transaction(RESOURCE_STORE, "readonly");
    const completion = transactionComplete(transaction);
    const value = await requestResult(transaction.objectStore(RESOURCE_STORE).get(expectedSha256));
    await completion;
    if (value === undefined) {
      return undefined;
    }
    return copyBytes(await assertStoredResource(value, expectedSha256));
  }

  async count(): Promise<number> {
    const database = await this.database();
    const transaction = database.transaction(RESOURCE_STORE, "readonly");
    const completion = transactionComplete(transaction);
    const result = await requestResult(transaction.objectStore(RESOURCE_STORE).count());
    await completion;
    return result;
  }

  private database(): Promise<IDBDatabase> {
    this.databasePromise ??= openDatabase(this.databaseName);
    return this.databasePromise;
  }
}

/** Deterministic cache used by Core tests and non-browser hosts. */
export class MemoryContentAddressedResourceCache implements ContentAddressedResourceCache {
  private readonly resources = new Map<string, Uint8Array>();

  async putVerified(
    expectedSha256: string,
    bytes: Uint8Array,
  ): Promise<VerifiedResourceCacheWrite> {
    await assertExpectedDigest(expectedSha256, bytes);
    const existing = this.resources.get(expectedSha256);
    if (existing) {
      if (!equalBytes(existing, bytes)) {
        throw new Error(`Immutable resource cache collision: ${expectedSha256}`);
      }
      return "present";
    }
    this.resources.set(expectedSha256, copyBytes(bytes));
    return "stored";
  }

  async getVerified(expectedSha256: string): Promise<Uint8Array | undefined> {
    assertDigest(expectedSha256);
    const value = this.resources.get(expectedSha256);
    if (!value) {
      return undefined;
    }
    await assertExpectedDigest(expectedSha256, value);
    return copyBytes(value);
  }

  async count(): Promise<number> {
    return this.resources.size;
  }
}

async function assertExpectedDigest(expectedSha256: string, bytes: Uint8Array): Promise<void> {
  assertDigest(expectedSha256);
  const actual = await sha256Hex(bytes);
  if (actual !== expectedSha256) {
    throw new Error("Refusing to cache resource bytes with a mismatched SHA-256");
  }
}

async function assertStoredResource(value: unknown, expectedSha256: string): Promise<Uint8Array> {
  if (
    typeof value !== "object"
    || value === null
    || !("sha256" in value)
    || value.sha256 !== expectedSha256
    || !("byteLength" in value)
    || typeof value.byteLength !== "number"
    || !("bytes" in value)
    || !(value.bytes instanceof Uint8Array)
    || value.byteLength !== value.bytes.byteLength
  ) {
    throw new Error(`Cached resource has an invalid structure: ${expectedSha256}`);
  }
  await assertExpectedDigest(expectedSha256, value.bytes);
  return value.bytes;
}

function openDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(RESOURCE_STORE)) {
        database.createObjectStore(RESOURCE_STORE, { keyPath: "sha256" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open resource cache"));
    request.onblocked = () => reject(new Error("Resource cache database upgrade is blocked"));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Resource cache request failed"));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(
      transaction.error ?? new Error("Resource cache transaction failed"),
    );
    transaction.onabort = () => reject(
      transaction.error ?? new Error("Resource cache transaction was aborted"),
    );
  });
}

function assertDigest(value: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error("Resource cache key must be a lowercase SHA-256 digest");
  }
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}
