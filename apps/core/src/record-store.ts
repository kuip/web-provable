import {
  isLocalRecordV1,
  verifyLocalRecordDigest,
  type LocalRecordSink,
  type LocalRecordV1,
} from "./records";

export interface LocalRecordStore extends LocalRecordSink {
  list(limit?: number): Promise<LocalRecordV1[]>;
  count(): Promise<number>;
}

interface StoredLocalRecord {
  id: string;
  sortAt: string;
  record: LocalRecordV1;
}

const DATABASE_VERSION = 1;
const RECORD_STORE = "records";
const SORT_INDEX = "sortAt";

/** Shared persistent record store for extension pages and regular browser pages. */
export class IndexedDbLocalRecordStore implements LocalRecordStore {
  private databasePromise: Promise<IDBDatabase> | undefined;

  constructor(private readonly databaseName = "provable-local-records") {}

  async put(record: LocalRecordV1): Promise<void> {
    assertRecord(record);
    if (!await verifyLocalRecordDigest(record)) {
      throw new Error("Refusing to store a local record with an invalid digest");
    }
    const database = await this.database();
    const transaction = database.transaction(RECORD_STORE, "readwrite");
    const completion = transactionComplete(transaction);
    transaction.objectStore(RECORD_STORE).add({
      id: record.id,
      sortAt: record.kind === "diagnostic" ? record.createdAt : record.endedAt,
      record,
    } satisfies StoredLocalRecord);
    await completion;
  }

  async list(limit = 100): Promise<LocalRecordV1[]> {
    assertListLimit(limit);
    const database = await this.database();
    const transaction = database.transaction(RECORD_STORE, "readonly");
    const completion = transactionComplete(transaction);
    const index = transaction.objectStore(RECORD_STORE).index(SORT_INDEX);
    const rows = await collectRecords(index.openCursor(null, "prev"), limit);
    await completion;

    const records: LocalRecordV1[] = [];
    for (const row of rows) {
      if (!isStoredLocalRecord(row)) {
        throw new Error("Stored local record has an invalid structure");
      }
      if (!await verifyLocalRecordDigest(row.record)) {
        throw new Error(`Stored local record has an invalid digest: ${row.id}`);
      }
      records.push(row.record);
    }
    return records;
  }

  async count(): Promise<number> {
    const database = await this.database();
    const transaction = database.transaction(RECORD_STORE, "readonly");
    const completion = transactionComplete(transaction);
    const result = await requestResult(transaction.objectStore(RECORD_STORE).count());
    await completion;
    return result;
  }

  private database(): Promise<IDBDatabase> {
    this.databasePromise ??= openDatabase(this.databaseName);
    return this.databasePromise;
  }
}

/** Deterministic store used by Core tests and non-browser hosts. */
export class MemoryLocalRecordStore implements LocalRecordStore {
  private readonly records = new Map<string, LocalRecordV1>();

  async put(record: LocalRecordV1): Promise<void> {
    assertRecord(record);
    if (!await verifyLocalRecordDigest(record)) {
      throw new Error("Refusing to store a local record with an invalid digest");
    }
    if (this.records.has(record.id)) {
      throw new Error(`Local record already exists: ${record.id}`);
    }
    this.records.set(record.id, structuredClone(record));
  }

  async list(limit = 100): Promise<LocalRecordV1[]> {
    assertListLimit(limit);
    return [...this.records.values()]
      .sort((left, right) => recordTime(right).localeCompare(recordTime(left)))
      .slice(0, limit)
      .map((record) => structuredClone(record));
  }

  async count(): Promise<number> {
    return this.records.size;
  }
}

function openDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(RECORD_STORE)) {
        const store = database.createObjectStore(RECORD_STORE, { keyPath: "id" });
        store.createIndex(SORT_INDEX, "sortAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open local records"));
    request.onblocked = () => reject(new Error("Local record database upgrade is blocked"));
  });
}

function collectRecords(
  request: IDBRequest<IDBCursorWithValue | null>,
  limit: number,
): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const rows: unknown[] = [];
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || rows.length >= limit) {
        resolve(rows);
        return;
      }
      rows.push(cursor.value);
      cursor.continue();
    };
    request.onerror = () => reject(request.error ?? new Error("Unable to read local records"));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Local record request failed"));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(
      transaction.error ?? new Error("Local record transaction failed"),
    );
    transaction.onabort = () => reject(
      transaction.error ?? new Error("Local record transaction was aborted"),
    );
  });
}

function assertRecord(record: LocalRecordV1): void {
  if (!isLocalRecordV1(record)) {
    throw new Error("Invalid local record");
  }
}

function assertListLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new Error("Local record limit must be an integer from 1 to 500");
  }
}

function isStoredLocalRecord(value: unknown): value is StoredLocalRecord {
  return typeof value === "object"
    && value !== null
    && "id" in value
    && typeof value.id === "string"
    && "sortAt" in value
    && typeof value.sortAt === "string"
    && "record" in value
    && isLocalRecordV1(value.record)
    && value.id === value.record.id
    && value.sortAt === recordTime(value.record);
}

function recordTime(record: LocalRecordV1): string {
  return record.kind === "diagnostic" ? record.createdAt : record.endedAt;
}
