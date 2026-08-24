import {
  IndexedDbLocalRecordStore,
  type LocalRecordStore,
} from "./record-store";
import {
  createDiagnosticRecord,
  type CreateDiagnosticRecordOptions,
  type DiagnosticRecordV1,
  type ExecutionRecordV1,
  type LocalRecordSink,
  type LocalRecordV1,
} from "./records";

export interface BrowserLocalRecordsOptions {
  countElement: HTMLElement;
  listElement: HTMLOListElement;
  locationLabel: string;
  store?: LocalRecordStore;
}

/** Shared local-record persistence and presentation for every browser adapter. */
export class BrowserLocalRecords implements LocalRecordSink {
  private readonly countElement: HTMLElement;
  private readonly listElement: HTMLOListElement;
  private readonly locationLabel: string;
  private readonly store: LocalRecordStore;

  constructor(options: BrowserLocalRecordsOptions) {
    this.countElement = options.countElement;
    this.listElement = options.listElement;
    this.locationLabel = options.locationLabel;
    this.store = options.store ?? new IndexedDbLocalRecordStore();
  }

  put(record: LocalRecordV1): Promise<void> {
    return this.store.put(record);
  }

  async recordDiagnostic(
    options: CreateDiagnosticRecordOptions,
    statusElement: HTMLElement,
  ): Promise<DiagnosticRecordV1 | undefined> {
    let record: DiagnosticRecordV1;
    try {
      record = await createDiagnosticRecord(options);
    } catch (error) {
      statusElement.textContent = `Diagnostic could not be created: ${formatError(error)}`;
      statusElement.dataset.status = "invalid";
      statusElement.hidden = false;
      return undefined;
    }

    try {
      await this.store.put(record);
      showDiagnosticRecord(record, undefined, statusElement);
    } catch (error) {
      showDiagnosticRecord(record, asError(error), statusElement);
    }
    void this.refresh();
    return record;
  }

  showExecutionRecord(
    record: ExecutionRecordV1,
    persistenceError: Error | undefined,
    statusElement: HTMLElement,
  ): void {
    if (persistenceError) {
      statusElement.textContent = `WasmX execution ${record.status}, but its local record could not be saved: ${persistenceError.message}`;
      statusElement.dataset.status = "invalid";
    } else if (record.status !== "succeeded") {
      statusElement.textContent = `${capitalize(record.status)} WasmX execution saved locally · never proof eligible`;
      statusElement.dataset.status = "invalid";
    } else if (record.proofEligibility.eligible) {
      statusElement.textContent = "WasmX execution saved locally · eligible for proof actions";
      statusElement.dataset.status = "verified";
    } else {
      statusElement.textContent = `WasmX execution saved locally · proof ineligible: ${proofReasonText(record)}`;
      delete statusElement.dataset.status;
    }
    statusElement.hidden = false;
    void this.refresh();
  }

  clearStatus(element: HTMLElement): void {
    element.textContent = "";
    element.hidden = true;
    delete element.dataset.status;
  }

  async refresh(): Promise<void> {
    try {
      const [count, records] = await Promise.all([
        this.store.count(),
        this.store.list(5),
      ]);
      this.countElement.textContent = `${count} unsigned local ${count === 1 ? "record" : "records"} ${this.locationLabel}`;
      delete this.countElement.dataset.status;
      this.listElement.replaceChildren(...(
        records.length > 0
          ? records.map((record) => this.listItem(record))
          : [this.listItem(undefined)]
      ));
    } catch (error) {
      this.countElement.textContent = `Local records unavailable: ${formatError(error)}`;
      this.countElement.dataset.status = "invalid";
      this.listElement.replaceChildren(this.listItem(undefined));
    }
  }

  private listItem(record: LocalRecordV1 | undefined): HTMLLIElement {
    const item = this.listElement.ownerDocument.createElement("li");
    if (!record) {
      item.textContent = "No local records yet.";
      return item;
    }
    const timestamp = record.kind === "diagnostic" ? record.createdAt : record.endedAt;
    const detail = record.kind === "diagnostic"
      ? `diagnostic · ${record.stage} · never proof eligible`
      : `${record.status} · ${record.proofEligibility.eligible ? "proof eligible" : "proof ineligible"}`;
    item.textContent = `${record.app.appId} · ${detail} · ${formatRecordTime(timestamp)} · ${record.recordSha256.slice(0, 12)}…`;
    return item;
  }
}

function showDiagnosticRecord(
  record: DiagnosticRecordV1,
  persistenceError: Error | undefined,
  statusElement: HTMLElement,
): void {
  if (persistenceError) {
    statusElement.textContent = `WasmX was not invoked, but the diagnostic could not be saved: ${persistenceError.message}`;
    statusElement.dataset.status = "invalid";
  } else {
    statusElement.textContent = `Diagnostic saved locally · ${record.stage} · never proof eligible`;
    delete statusElement.dataset.status;
  }
  statusElement.hidden = false;
}

function proofReasonText(record: ExecutionRecordV1): string {
  return record.proofEligibility.reasons.map((reason) => ({
    "execution-not-successful": "execution did not succeed",
    "output-schema-invalid": "output schema was invalid",
    "source-unverified": "source was not locally verified",
    "source-unanchored": "Kayros source is not anchored to a trusted root",
  })[reason]).join(", ");
}

function formatRecordTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase()}${value.slice(1)}`;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
