import {
  BrowserGoogleDriveConnection,
  BrowserLocalRecords,
  BundledPublisherTrustPolicy,
  executeAndRecord,
  findKayrosRecordByHash,
  findKayrosRecordBySha3,
  findKayrosRecordsByDataItem,
  getLatestKayrosHash,
  IndexedDbContentAddressedResourceCache,
  loadVerifiedBrowserApp,
  kayrosHashToHex,
  kayrosSourceVerification,
  normalizeKayrosApiKey,
  observeBrowserHeaderHeight,
  renderBrowserMarkdownForm,
  type AppExecutor,
  type AppBuildIdentityV1,
  type AppReleaseManifest,
  type DiagnosticStageV1,
  type KayrosConnectionOptions,
  type RecordErrorV1,
  type WasmXSha3Module,
} from "@provable/core";
import {
  runProveInclusionWorkflow,
  type ProveInclusionInput,
  type ProveInclusionOutput,
} from "@provable/prove-inclusion";
import {
  runVerifyKayrosWorkflow,
  type VerifyKayrosLookup,
  type VerifyKayrosModuleInput,
  type VerifyKayrosOutput,
} from "@provable/verify-kayros";

interface RuntimeConfig {
  schemaVersion: 1;
  profile: "web";
  kayros: {
    apiBaseUrl: string;
    dashboardUrl: string;
    dataType: "provable_sdk";
    table: "s32_hashes";
  };
}

interface LoadedApp {
  config: RuntimeConfig;
  kayrosApiKey: string;
  identity: AppBuildIdentityV1;
  manifest: AppReleaseManifest;
  runner: AppExecutor<ProveInclusionInput, ProveInclusionOutput>;
  sha3: WasmXSha3Module;
}

interface LoadedVerifyKayrosApp {
  identity: AppBuildIdentityV1;
  manifest: AppReleaseManifest;
  runner: AppExecutor<VerifyKayrosModuleInput, VerifyKayrosOutput>;
  sha3: WasmXSha3Module;
}

interface ProveControls {
  form: HTMLFormElement;
  textA: HTMLTextAreaElement;
  textB: HTMLInputElement;
  threshold: HTMLInputElement;
  contentHashOutput: HTMLOutputElement;
  kayrosMatchOutput: HTMLOutputElement;
  kayrosTimestampOutput: HTMLOutputElement;
  kayrosBlockOutput: HTMLOutputElement;
  countOutput: HTMLOutputElement;
  resultOutput: HTMLOutputElement;
  runButton: HTMLButtonElement;
}

interface VerifyKayrosControls {
  form: HTMLFormElement;
  recordHash: HTMLInputElement;
  dataItem: HTMLInputElement;
  lookupStatus: HTMLOutputElement;
  recordDataType: HTMLOutputElement;
  recordDataItem: HTMLOutputElement;
  previousHash: HTMLOutputElement;
  storedHash: HTMLOutputElement;
  localHash: HTMLOutputElement;
  hashType: HTMLOutputElement;
  hashMatches: HTMLOutputElement;
  kayrosTimestamp: HTMLOutputElement;
  kayrosBlock: HTMLOutputElement;
  runButton: HTMLButtonElement;
}

const viewSelector = requiredElement<HTMLSelectElement>("view-selector");
const shellHeader = requiredElement<HTMLElement>("shell-header");
const coreView = requiredElement<HTMLElement>("core-view");
const proveInclusionView = requiredElement<HTMLElement>("prove-inclusion-view");
const verifyKayrosView = requiredElement<HTMLElement>("verify-kayros-view");
const appContent = requiredElement<HTMLElement>("app-content");
const moduleStatus = requiredElement<HTMLElement>("module-status");
const moduleDigest = requiredElement<HTMLElement>("module-digest");
const uiDigest = requiredElement<HTMLElement>("ui-digest");
const coreModuleDigest = requiredElement<HTMLElement>("core-module-digest");
const manifestDigest = requiredElement<HTMLElement>("manifest-digest");
const closureDigest = requiredElement<HTMLElement>("closure-digest");
const publisherTrust = requiredElement<HTMLElement>("publisher-trust");
const resourceCacheStatus = requiredElement<HTMLElement>("resource-cache-status");
const errorMessage = requiredElement<HTMLElement>("error-message");
const proveRecordStatus = requiredElement<HTMLElement>("prove-record-status");
const urlImportStatus = requiredElement<HTMLElement>("url-import-status");
const latestKayrosHash = requiredElement<HTMLElement>("latest-kayros-hash");
const latestKayrosMetadata = requiredElement<HTMLElement>("latest-kayros-metadata");
const latestKayrosError = requiredElement<HTMLElement>("latest-kayros-error");
const refreshKayrosButton = requiredElement<HTMLButtonElement>("refresh-kayros");
const kayrosDashboardLink = requiredElement<HTMLAnchorElement>("kayros-dashboard-link");
const kayrosSettingsForm = requiredElement<HTMLFormElement>("kayros-settings-form");
const kayrosApiKeyInput = requiredElement<HTMLInputElement>("kayros-api-key");
const kayrosApiKeyStatus = requiredElement<HTMLElement>("kayros-api-key-status");
const saveKayrosApiKeyButton = requiredElement<HTMLButtonElement>("save-kayros-api-key");
const clearKayrosApiKeyButton = requiredElement<HTMLButtonElement>("clear-kayros-api-key");
const codeIntegrity = requiredElement<HTMLElement>("code-integrity");
const verifyKayrosContent = requiredElement<HTMLElement>("verify-kayros-content");
const verifyKayrosError = requiredElement<HTMLElement>("verify-kayros-error");
const verifyKayrosRecordStatus = requiredElement<HTMLElement>(
  "verify-kayros-record-status",
);
const verifyKayrosIntegrity = requiredElement<HTMLElement>("verify-kayros-integrity");
const verifyKayrosModuleStatus = requiredElement<HTMLElement>("verify-kayros-module-status");
const verifyKayrosModuleDigest = requiredElement<HTMLElement>("verify-kayros-module-digest");
const verifyKayrosUiDigest = requiredElement<HTMLElement>("verify-kayros-ui-digest");
const verifyKayrosCoreDigest = requiredElement<HTMLElement>("verify-kayros-core-digest");
const verifyKayrosManifestDigest = requiredElement<HTMLElement>(
  "verify-kayros-manifest-digest",
);
const verifyKayrosClosureDigest = requiredElement<HTMLElement>(
  "verify-kayros-closure-digest",
);
const verifyKayrosPublisherTrust = requiredElement<HTMLElement>(
  "verify-kayros-publisher-trust",
);
const verifyKayrosResourceCacheStatus = requiredElement<HTMLElement>(
  "verify-kayros-resource-cache-status",
);
const localRecordCount = requiredElement<HTMLElement>("local-record-count");
const localRecordList = requiredElement<HTMLOListElement>("local-record-list");
const googleDriveAccount = requiredElement<HTMLElement>("google-drive-account");
const googleDriveStatus = requiredElement<HTMLElement>("google-drive-status");
const connectGoogleDriveButton = requiredElement<HTMLButtonElement>(
  "connect-google-drive",
);
const disconnectGoogleDriveButton = requiredElement<HTMLButtonElement>(
  "disconnect-google-drive",
);

const KAYROS_API_KEY_STORAGE_KEY = "provable.web.kayrosApiKey";
const MAX_URL_FRAGMENT_LENGTH = 1_500_000;
const localRecords = new BrowserLocalRecords({
  countElement: localRecordCount,
  listElement: localRecordList,
  locationLabel: "on this site",
});
const googleDriveConnection = new BrowserGoogleDriveConnection({
  accountElement: googleDriveAccount,
  statusElement: googleDriveStatus,
  connectButton: connectGoogleDriveButton,
  disconnectButton: disconnectGoogleDriveButton,
});
googleDriveConnection.setUnavailable(
  "Google Drive sign-in is available in the Chrome extension; this static site does not load Google's remote sign-in code.",
);
const resourceCache = new IndexedDbContentAddressedResourceCache();
const trustPolicy = new BundledPublisherTrustPolicy(
  "github-pages-bundle",
  ["github:kuip"],
);
const bundleRootUrl = new URL("../", import.meta.url).href;
let loadedApp: LoadedApp | undefined;
let latestKayrosLoaded = false;

observeBrowserHeaderHeight(shellHeader);
viewSelector.addEventListener("change", showSelectedView);
refreshKayrosButton.addEventListener("click", () => {
  void refreshLatestKayros(true);
});
kayrosSettingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveKayrosApiKey();
});
clearKayrosApiKeyButton.addEventListener("click", clearKayrosApiKey);
kayrosApiKeyInput.addEventListener("input", () => {
  kayrosApiKeyStatus.textContent = "Unsaved API key change";
  delete kayrosApiKeyStatus.dataset.status;
});

showSelectedView();
void initialize().catch(showLoadError);

async function initialize(): Promise<void> {
  moduleStatus.textContent = "Verifying packaged UI, app module, and core module…";
  verifyKayrosModuleStatus.textContent = "Verifying packaged UI, app module, and core module…";
  const [verified, verifyKayros, configResponse] = await Promise.all([
    loadVerifiedBrowserApp<ProveInclusionInput, ProveInclusionOutput>({
      appManifestUrl: "./apps/prove-inclusion/app.json",
      bundleRootUrl,
      coreManifestUrl: "./apps/core/app.json",
      resourceCache,
      trustPolicy,
      workerUrl: "./assets/wasmx-worker.js",
    }),
    loadVerifiedBrowserApp<VerifyKayrosModuleInput, VerifyKayrosOutput>({
      appManifestUrl: "./apps/verify-kayros/app.json",
      bundleRootUrl,
      coreManifestUrl: "./apps/core/app.json",
      resourceCache,
      trustPolicy,
      workerUrl: "./assets/wasmx-worker.js",
    }),
    fetch("./config.json"),
  ]);
  assertResponse(configResponse, "runtime config");
  const configValue: unknown = await configResponse.json();
  assertRuntimeConfig(configValue);

  const loaded: LoadedApp = {
    config: configValue,
    kayrosApiKey: readStoredKayrosApiKey(),
    identity: verified.identity,
    manifest: verified.manifest,
    runner: verified.runner,
    sha3: verified.sha3,
  };
  loadedApp = loaded;
  kayrosDashboardLink.href = loaded.config.kayros.dashboardUrl;
  configureKayrosSettings(loaded);

  moduleDigest.textContent = verified.moduleDigest;
  uiDigest.textContent = verified.uiDigest;
  coreModuleDigest.textContent = verified.coreDigest;
  manifestDigest.textContent = verified.manifestDigest;
  closureDigest.textContent = verified.digestGraph.closureSha256;
  publisherTrust.textContent = formatTrust(verified.trust);
  resourceCacheStatus.textContent = formatCacheStatus(verified.cache);
  moduleStatus.textContent = "Packaged UI and modules verified";
  moduleStatus.dataset.status = "verified";
  verifyKayrosModuleDigest.textContent = verifyKayros.moduleDigest;
  verifyKayrosUiDigest.textContent = verifyKayros.uiDigest;
  verifyKayrosCoreDigest.textContent = verifyKayros.coreDigest;
  verifyKayrosManifestDigest.textContent = verifyKayros.manifestDigest;
  verifyKayrosClosureDigest.textContent = verifyKayros.digestGraph.closureSha256;
  verifyKayrosPublisherTrust.textContent = formatTrust(verifyKayros.trust);
  verifyKayrosResourceCacheStatus.textContent = formatCacheStatus(verifyKayros.cache);
  verifyKayrosModuleStatus.textContent = "Packaged UI and modules verified";
  verifyKayrosModuleStatus.dataset.status = "verified";

  const verifyKayrosApp: LoadedVerifyKayrosApp = {
    identity: verifyKayros.identity,
    manifest: verifyKayros.manifest,
    runner: verifyKayros.runner,
    sha3: verifyKayros.sha3,
  };

  const controls = renderAppTemplate(verified.markdown, verified.manifest);
  const verifyControls = renderVerifyKayrosTemplate(
    verifyKayros.markdown,
    verifyKayros.manifest,
  );
  controls.form.addEventListener("submit", (event) => {
    event.preventDefault();
    void runPreview(loaded, controls);
  });
  for (const field of [controls.textA, controls.textB, controls.threshold]) {
    field.addEventListener("input", () => resetResult(controls));
  }
  verifyControls.form.addEventListener("submit", (event) => {
    event.preventDefault();
    void runVerifyKayrosPreview(loaded, verifyKayrosApp, verifyControls);
  });
  for (const field of [verifyControls.recordHash, verifyControls.dataItem]) {
    field.addEventListener("input", () => resetVerifyKayrosResult(verifyControls));
  }
  applyUrlPrefill(controls, verifyControls);

  appContent.ariaBusy = "false";
  verifyKayrosContent.ariaBusy = "false";
  void refreshLocalRecordSummary();
  if (viewSelector.value === "core") {
    void refreshLatestKayros();
  }
}

function formatTrust(trust: {
  publisherClaim: string;
  publisherClaimStatus: "bundle-allowlisted";
  publisherSignatureStatus: "not-configured";
}): string {
  return `${trust.publisherClaim} claim · bundle authorized · publisher signature not configured`;
}

function formatCacheStatus(cache: { storedCount: number; presentCount: number }): string {
  return `Verified cache before execution · ${cache.storedCount} stored · ${cache.presentCount} already present`;
}

function renderAppTemplate(markdown: string, manifest: AppReleaseManifest): ProveControls {
  const rendered = renderBrowserMarkdownForm(markdown, manifest, {
    actionLabels: { run: "Verify A and count B" },
    documentationFooter: codeIntegrity,
    inputPlaceholders: {
      a: "Text whose SHA3-256 should be recorded by Kayros",
      b: "Text to find",
      n: "0 (default)",
    },
    multilineTextFields: ["a"],
  });
  rendered.form.id = "prove-form";
  appContent.replaceChildren(rendered.form);
  return {
    form: rendered.form,
    textA: requiredRendered<HTMLTextAreaElement>(rendered.fields, "a"),
    textB: requiredRendered<HTMLInputElement>(rendered.fields, "b"),
    threshold: requiredRendered<HTMLInputElement>(rendered.fields, "n"),
    contentHashOutput: requiredRendered<HTMLOutputElement>(rendered.fields, "contentHash"),
    kayrosMatchOutput: requiredRendered<HTMLOutputElement>(rendered.fields, "kayrosMatch"),
    kayrosTimestampOutput: requiredRendered<HTMLOutputElement>(rendered.fields, "kayrosTimestamp"),
    kayrosBlockOutput: requiredRendered<HTMLOutputElement>(rendered.fields, "kayrosBlock"),
    countOutput: requiredRendered<HTMLOutputElement>(rendered.fields, "count"),
    resultOutput: requiredRendered<HTMLOutputElement>(rendered.fields, "result"),
    runButton: requiredRendered<HTMLButtonElement>(rendered.actions, "run"),
  };
}

function renderVerifyKayrosTemplate(
  markdown: string,
  manifest: AppReleaseManifest,
): VerifyKayrosControls {
  const rendered = renderBrowserMarkdownForm(markdown, manifest, {
    actionLabels: { run: "Search and verify locally" },
    documentationFooter: verifyKayrosIntegrity,
    inputPlaceholders: {
      recordHash: "64 hexadecimal characters or 32-byte Base64",
      dataItem: "64 hexadecimal characters or 32-byte Base64",
    },
    multilineTextFields: [],
  });
  rendered.form.id = "verify-kayros-form";
  verifyKayrosContent.replaceChildren(rendered.form);
  return {
    form: rendered.form,
    recordHash: requiredRendered<HTMLInputElement>(rendered.fields, "recordHash"),
    dataItem: requiredRendered<HTMLInputElement>(rendered.fields, "dataItem"),
    lookupStatus: requiredRendered<HTMLOutputElement>(rendered.fields, "lookupStatus"),
    recordDataType: requiredRendered<HTMLOutputElement>(rendered.fields, "recordDataType"),
    recordDataItem: requiredRendered<HTMLOutputElement>(rendered.fields, "recordDataItem"),
    previousHash: requiredRendered<HTMLOutputElement>(rendered.fields, "previousHash"),
    storedHash: requiredRendered<HTMLOutputElement>(rendered.fields, "storedHash"),
    localHash: requiredRendered<HTMLOutputElement>(rendered.fields, "localHash"),
    hashType: requiredRendered<HTMLOutputElement>(rendered.fields, "hashType"),
    hashMatches: requiredRendered<HTMLOutputElement>(rendered.fields, "hashMatches"),
    kayrosTimestamp: requiredRendered<HTMLOutputElement>(rendered.fields, "kayrosTimestamp"),
    kayrosBlock: requiredRendered<HTMLOutputElement>(rendered.fields, "kayrosBlock"),
    runButton: requiredRendered<HTMLButtonElement>(rendered.actions, "run"),
  };
}

async function runVerifyKayrosPreview(
  runtime: LoadedApp,
  app: LoadedVerifyKayrosApp,
  controls: VerifyKayrosControls,
): Promise<void> {
  setVerifyKayrosBusy(controls, true);
  clearVerifyKayrosError();
  clearRecordStatus(verifyKayrosRecordStatus);
  let validAttempt = false;
  let lookupCompleted = false;
  let wasmxInvoked = false;
  let diagnosticRecorded = false;
  let lookup: VerifyKayrosLookup | undefined;
  try {
    lookup = readVerifyKayrosLookup(controls);
    assertSyntacticallyValidVerifyLookup(lookup);
    validAttempt = true;
    const workflow = await runVerifyKayrosWorkflow(lookup, {
      findByRecordHash: async (recordHash) => {
        const record = await findKayrosRecordByHash(
          recordHash,
          kayrosConnection(runtime),
          runtime.config.kayros.dataType,
        );
        lookupCompleted = true;
        return record;
      },
      findByDataItem: async (dataItem) => {
        const records = await findKayrosRecordsByDataItem(
          dataItem,
          kayrosConnection(runtime),
          runtime.config.kayros.dataType,
        );
        lookupCompleted = true;
        return records;
      },
      run: async (moduleInput, sourceRecord) => {
        const inputBytes = new TextEncoder().encode(JSON.stringify(moduleInput));
        if (inputBytes.byteLength > app.manifest.resourceLimits.maxInputBytes) {
          const error = new Error("Kayros record exceeds the app input limit");
          diagnosticRecorded = true;
          await recordDiagnostic(
            app.identity,
            moduleInput,
            "input-limit",
            { code: "input-too-large", message: error.message },
            verifyKayrosRecordStatus,
            ["kayros:read"],
          );
          throw error;
        }
        wasmxInvoked = true;
        const execution = await executeAndRecord(app.runner, moduleInput, {
          app: app.identity,
          records: localRecords,
          capabilitiesUsed: ["kayros:read"],
          sourceVerification: kayrosSourceVerification(sourceRecord, {
            apiBaseUrl: runtime.config.kayros.apiBaseUrl,
            locallyVerified: false,
            verificationMethod: "local-chain-hash",
          }),
          sourceVerificationFromOutput: (output) => kayrosSourceVerification(
            sourceRecord,
            {
              apiBaseUrl: runtime.config.kayros.apiBaseUrl,
              locallyVerified: output.matches,
              verificationMethod: "local-chain-hash",
            },
          ),
          onRecord: (record, persistenceError) => {
            localRecords.showExecutionRecord(
              record,
              persistenceError,
              verifyKayrosRecordStatus,
            );
          },
        });
        return execution.output;
      },
      sha3_256: (bytes) => app.sha3.sha3_256(bytes),
    });

    if (workflow.status === "not-found") {
      setOutput(controls.lookupStatus, "Not found");
      const error = new Error(`No ${workflow.lookupKind} record was found in Kayros`);
      diagnosticRecorded = true;
      await recordDiagnostic(
        app.identity,
        lookup,
        "source-not-found",
        { code: "kayros-source-not-found", message: error.message },
        verifyKayrosRecordStatus,
      );
      throw error;
    }
    if (workflow.status === "ambiguous") {
      setOutput(controls.lookupStatus, `Ambiguous (${workflow.count} records)`);
      const error = new Error(
        `The data item matches ${workflow.count} Kayros records. Search by a record hash instead.`,
      );
      diagnosticRecorded = true;
      await recordDiagnostic(
        app.identity,
        lookup,
        "source-verification",
        { code: "kayros-source-ambiguous", message: error.message },
        verifyKayrosRecordStatus,
      );
      throw error;
    }

    const { record, output } = workflow;
    setOutput(controls.lookupStatus, "Found");
    setOutput(controls.recordDataType, record.dataType);
    setOutput(controls.recordDataItem, record.dataItem);
    setOutput(controls.previousHash, record.prevHash ?? "00".repeat(32));
    setOutput(controls.storedHash, record.hashItem);
    setOutput(controls.localHash, output.computedHash);
    setOutput(controls.hashType, record.hashType);
    setBooleanOutput(controls.hashMatches, output.matches);
    setOutput(controls.kayrosTimestamp, record.timestamp);
    setOutput(controls.kayrosBlock, String(record.block));
    if (!output.matches) {
      throw new Error("Local verification failed: the calculated hash does not match Kayros");
    }
  } catch (error) {
    if (validAttempt && !wasmxInvoked && !diagnosticRecorded && lookup) {
      await recordDiagnostic(
        app.identity,
        lookup,
        lookupCompleted ? "source-verification" : "source-lookup",
        {
          code: lookupCompleted ? "kayros-source-invalid" : "kayros-lookup-failed",
          message: formatError(error),
        },
        verifyKayrosRecordStatus,
      );
    }
    showVerifyKayrosError(error);
  } finally {
    setVerifyKayrosBusy(controls, false);
  }
}

function readVerifyKayrosLookup(controls: VerifyKayrosControls): VerifyKayrosLookup {
  const recordHash = controls.recordHash.value.trim();
  const dataItem = controls.dataItem.value.trim();
  const lookup: VerifyKayrosLookup = {};
  if (recordHash.length > 0) {
    lookup.recordHash = recordHash;
  }
  if (dataItem.length > 0) {
    lookup.dataItem = dataItem;
  }
  return lookup;
}

function assertSyntacticallyValidVerifyLookup(lookup: VerifyKayrosLookup): void {
  const recordHash = lookup.recordHash?.trim() ?? "";
  const dataItem = lookup.dataItem?.trim() ?? "";
  if ((recordHash.length === 0) === (dataItem.length === 0)) {
    throw new Error("Enter exactly one Kayros record hash or data item");
  }
  kayrosHashToHex(recordHash || dataItem);
}

async function runPreview(loaded: LoadedApp, controls: ProveControls): Promise<void> {
  setBusy(controls, true);
  clearError();
  clearRecordStatus(proveRecordStatus);
  let input: ProveInclusionInput | undefined;
  let contentHashComputed = false;
  let wasmxInvoked = false;
  let diagnosticRecorded = false;
  try {
    input = readInput(controls);
    const inputBytes = new TextEncoder().encode(JSON.stringify(input));
    if (inputBytes.byteLength > loaded.manifest.resourceLimits.maxInputBytes) {
      const error = new Error("Input exceeds the app limit");
      diagnosticRecorded = true;
      await recordDiagnostic(
        loaded.identity,
        input,
        "input-limit",
        { code: "input-too-large", message: error.message },
        proveRecordStatus,
      );
      throw error;
    }

    const workflow = await runProveInclusionWorkflow(input, {
      sha3_256: (value) => {
        const digest = loaded.sha3.sha3_256(value);
        contentHashComputed = true;
        return digest;
      },
      findNotarization: (contentHash) => findKayrosRecordBySha3(
        contentHash,
        kayrosConnection(loaded),
        loaded.config.kayros.dataType,
      ),
      run: async (workflowInput, sourceRecord) => {
        wasmxInvoked = true;
        const execution = await executeAndRecord(loaded.runner, workflowInput, {
          app: loaded.identity,
          records: localRecords,
          capabilitiesUsed: ["kayros:read"],
          sourceVerification: kayrosSourceVerification(sourceRecord, {
            apiBaseUrl: loaded.config.kayros.apiBaseUrl,
            locallyVerified: true,
            verificationMethod: "database-match",
          }),
          onRecord: (record, persistenceError) => {
            localRecords.showExecutionRecord(record, persistenceError, proveRecordStatus);
          },
        });
        return execution.output;
      },
    });
    setOutput(controls.contentHashOutput, workflow.contentHash);

    if (workflow.status === "lookup-error") {
      setOutput(controls.kayrosMatchOutput, "Unavailable");
      delete controls.kayrosMatchOutput.dataset.value;
      const error = new Error(
        `Kayros lookup failed: ${workflow.error}. The inclusion count was not run.`,
      );
      diagnosticRecorded = true;
      await recordDiagnostic(
        loaded.identity,
        input,
        "source-lookup",
        { code: "kayros-lookup-failed", message: error.message },
        proveRecordStatus,
      );
      throw error;
    }
    if (workflow.status === "not-found") {
      setBooleanOutput(controls.kayrosMatchOutput, false);
      const error = new Error(
        `SHA3-256 of A was not found in Kayros ${loaded.config.kayros.table} for ${loaded.config.kayros.dataType}. The inclusion count was not run.`,
      );
      diagnosticRecorded = true;
      await recordDiagnostic(
        loaded.identity,
        input,
        "source-not-found",
        { code: "kayros-source-not-found", message: error.message },
        proveRecordStatus,
      );
      throw error;
    }

    setBooleanOutput(controls.kayrosMatchOutput, true);
    setOutput(controls.kayrosTimestampOutput, workflow.record.timestamp);
    setOutput(controls.kayrosBlockOutput, String(workflow.record.block));
    setOutput(controls.countOutput, String(workflow.output.count));
    setBooleanOutput(controls.resultOutput, workflow.output.result);
  } catch (error) {
    if (input && !wasmxInvoked && !diagnosticRecorded) {
      await recordDiagnostic(
        loaded.identity,
        input,
        contentHashComputed ? "source-verification" : "integrity",
        {
          code: contentHashComputed ? "kayros-source-invalid" : "integrity-failed",
          message: formatError(error),
        },
        proveRecordStatus,
      );
    }
    showError(error);
  } finally {
    setBusy(controls, false);
  }
}

function readInput(controls: ProveControls): ProveInclusionInput {
  if (controls.textA.value.length === 0) {
    throw new Error("Text A is required");
  }
  if (controls.textB.value.length === 0) {
    throw new Error("Text B is required");
  }
  const threshold = controls.threshold.value.trim();
  if (threshold.length === 0) {
    return { a: controls.textA.value, b: controls.textB.value };
  }
  const n = Number(threshold);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error("N must be a non-negative integer");
  }
  return { a: controls.textA.value, b: controls.textB.value, n };
}

function applyUrlPrefill(
  controls: ProveControls,
  verifyControls: VerifyKayrosControls,
): void {
  const fragment = window.location.hash.slice(1);
  if (fragment.length === 0) {
    return;
  }

  try {
    if (fragment.length > MAX_URL_FRAGMENT_LENGTH) {
      throw new Error("URL input exceeds the import limit");
    }
    const parameters = new URLSearchParams(fragment);
    if (parameters.get("v") !== "1") {
      throw new Error("Unsupported Provable URL version");
    }
    const app = parameters.get("app");
    if (app === "prove-inclusion") {
      const a = parameters.get("a");
      const b = parameters.get("b");
      const n = parameters.get("n");
      if (a === null && b === null && n === null) {
        throw new Error("Provable URL contains no input values");
      }
      if (a !== null) {
        controls.textA.value = a;
      }
      if (b !== null) {
        controls.textB.value = b;
      }
      if (n !== null && n.length > 0) {
        const threshold = Number(n);
        if (!Number.isSafeInteger(threshold) || threshold < 0) {
          throw new Error("URL parameter N must be a non-negative integer");
        }
        controls.threshold.value = String(threshold);
      }
    } else if (app === "verify-kayros") {
      const recordHash = parameters.get("recordHash");
      const dataItem = parameters.get("dataItem");
      if (recordHash === null && dataItem === null) {
        throw new Error("Provable URL contains no Verify Kayros lookup value");
      }
      verifyControls.recordHash.value = recordHash ?? "";
      verifyControls.dataItem.value = dataItem ?? "";
    } else {
      throw new Error("Unsupported Provable URL application");
    }

    viewSelector.value = app;
    showSelectedView();
    urlImportStatus.textContent = "Inputs loaded from the URL and removed from the address bar. Review them before running.";
    urlImportStatus.hidden = false;
  } catch (error) {
    urlImportStatus.textContent = formatError(error);
    urlImportStatus.dataset.status = "invalid";
    urlImportStatus.hidden = false;
  } finally {
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  }
}

async function refreshLatestKayros(force = false): Promise<void> {
  if (!loadedApp || (latestKayrosLoaded && !force)) {
    return;
  }
  refreshKayrosButton.disabled = true;
  latestKayrosHash.textContent = "Loading…";
  latestKayrosError.hidden = true;
  latestKayrosError.textContent = "";
  try {
    const record = await getLatestKayrosHash(
      kayrosConnection(loadedApp),
      loadedApp.config.kayros.dataType,
    );
    latestKayrosHash.textContent = record.hashItem;
    latestKayrosMetadata.textContent = [
      loadedApp.config.kayros.table,
      record.dataType,
      `block / position ${record.block}`,
      record.timestamp,
    ].join(" · ");
    latestKayrosLoaded = true;
  } catch (error) {
    latestKayrosHash.textContent = "Unavailable";
    latestKayrosError.textContent = formatError(error);
    latestKayrosError.hidden = false;
  } finally {
    refreshKayrosButton.disabled = false;
  }
}

function configureKayrosSettings(loaded: LoadedApp): void {
  kayrosApiKeyInput.disabled = false;
  saveKayrosApiKeyButton.disabled = false;
  clearKayrosApiKeyButton.disabled = false;
  kayrosApiKeyInput.value = loaded.kayrosApiKey;
  if (loaded.kayrosApiKey.length === 0) {
    kayrosApiKeyStatus.textContent = "No API key configured";
    delete kayrosApiKeyStatus.dataset.status;
    return;
  }
  kayrosApiKeyStatus.textContent = "API key saved on this device";
  kayrosApiKeyStatus.dataset.status = "verified";
}

async function saveKayrosApiKey(): Promise<void> {
  if (!loadedApp) {
    return;
  }
  try {
    const apiKey = normalizeKayrosApiKey(kayrosApiKeyInput.value);
    localStorage.setItem(KAYROS_API_KEY_STORAGE_KEY, apiKey);
    loadedApp.kayrosApiKey = apiKey;
    latestKayrosLoaded = false;
    kayrosApiKeyStatus.textContent = "API key saved on this device";
    kayrosApiKeyStatus.dataset.status = "verified";
    if (viewSelector.value === "core") {
      await refreshLatestKayros(true);
    }
  } catch (error) {
    kayrosApiKeyStatus.textContent = formatError(error);
    kayrosApiKeyStatus.dataset.status = "invalid";
  }
}

function clearKayrosApiKey(): void {
  if (!loadedApp) {
    return;
  }
  try {
    localStorage.removeItem(KAYROS_API_KEY_STORAGE_KEY);
    loadedApp.kayrosApiKey = "";
    kayrosApiKeyInput.value = "";
    latestKayrosLoaded = false;
    latestKayrosHash.textContent = "API key required";
    latestKayrosMetadata.textContent = `${loadedApp.config.kayros.table} · ${loadedApp.config.kayros.dataType}`;
    latestKayrosError.hidden = true;
    latestKayrosError.textContent = "";
    kayrosApiKeyStatus.textContent = "API key cleared; Kayros lookups are disabled";
    delete kayrosApiKeyStatus.dataset.status;
  } catch (error) {
    kayrosApiKeyStatus.textContent = formatError(error);
    kayrosApiKeyStatus.dataset.status = "invalid";
  }
}

function readStoredKayrosApiKey(): string {
  try {
    return localStorage.getItem(KAYROS_API_KEY_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function kayrosConnection(loaded: LoadedApp): KayrosConnectionOptions {
  return {
    apiKey: loaded.kayrosApiKey,
    baseUrl: loaded.config.kayros.apiBaseUrl,
  };
}

function resetResult(controls: ProveControls): void {
  for (const output of [
    controls.contentHashOutput,
    controls.kayrosMatchOutput,
    controls.kayrosTimestampOutput,
    controls.kayrosBlockOutput,
    controls.countOutput,
    controls.resultOutput,
  ]) {
    setOutput(output, "—");
    delete output.dataset.value;
  }
  clearError();
  clearRecordStatus(proveRecordStatus);
}

function resetVerifyKayrosResult(controls: VerifyKayrosControls): void {
  for (const output of verifyKayrosOutputs(controls)) {
    setOutput(output, "—");
    delete output.dataset.value;
  }
  clearVerifyKayrosError();
  clearRecordStatus(verifyKayrosRecordStatus);
}

async function recordDiagnostic(
  app: AppBuildIdentityV1,
  input: unknown,
  stage: DiagnosticStageV1,
  error: RecordErrorV1,
  statusElement: HTMLElement,
  capabilitiesUsed = stage.startsWith("source-") ? ["kayros:read"] : [],
): Promise<void> {
  await localRecords.recordDiagnostic({
    app,
    input,
    stage,
    error,
    capabilitiesUsed,
  }, statusElement);
}

async function refreshLocalRecordSummary(): Promise<void> {
  await localRecords.refresh();
}

function clearRecordStatus(element: HTMLElement): void {
  localRecords.clearStatus(element);
}

function showSelectedView(): void {
  const showCore = viewSelector.value === "core";
  const showProveInclusion = viewSelector.value === "prove-inclusion";
  coreView.hidden = !showCore;
  proveInclusionView.hidden = !showProveInclusion;
  verifyKayrosView.hidden = viewSelector.value !== "verify-kayros";
  if (showCore && loadedApp) {
    void refreshLatestKayros();
    void refreshLocalRecordSummary();
  }
}

function setBusy(controls: ProveControls, busy: boolean): void {
  controls.runButton.disabled = busy;
  controls.runButton.textContent = busy ? "Verifying A…" : "Verify A and count B";
}

function setVerifyKayrosBusy(controls: VerifyKayrosControls, busy: boolean): void {
  controls.runButton.disabled = busy;
  controls.runButton.textContent = busy ? "Verifying record…" : "Search and verify locally";
}

function setOutput(output: HTMLOutputElement, value: string): void {
  output.value = value;
  output.textContent = value;
}

function setBooleanOutput(output: HTMLOutputElement, value: boolean): void {
  setOutput(output, value ? "True" : "False");
  output.dataset.value = String(value);
}

function showLoadError(error: unknown): void {
  appContent.ariaBusy = "false";
  verifyKayrosContent.ariaBusy = "false";
  moduleStatus.textContent = "Integrity verification failed";
  moduleStatus.dataset.status = "invalid";
  verifyKayrosModuleStatus.textContent = "Integrity verification failed";
  verifyKayrosModuleStatus.dataset.status = "invalid";
  showError(error);
  showVerifyKayrosError(error);
}

function showError(error: unknown): void {
  errorMessage.textContent = formatError(error);
  errorMessage.hidden = false;
}

function clearError(): void {
  errorMessage.textContent = "";
  errorMessage.hidden = true;
}

function showVerifyKayrosError(error: unknown): void {
  verifyKayrosError.textContent = formatError(error);
  verifyKayrosError.hidden = false;
}

function clearVerifyKayrosError(): void {
  verifyKayrosError.textContent = "";
  verifyKayrosError.hidden = true;
}

function verifyKayrosOutputs(controls: VerifyKayrosControls): HTMLOutputElement[] {
  return [
    controls.lookupStatus,
    controls.recordDataType,
    controls.recordDataItem,
    controls.previousHash,
    controls.storedHash,
    controls.localHash,
    controls.hashType,
    controls.hashMatches,
    controls.kayrosTimestamp,
    controls.kayrosBlock,
  ];
}

function assertResponse(response: Response, label: string): void {
  if (!response.ok) {
    throw new Error(`Unable to load ${label} (${response.status})`);
  }
}

function assertRuntimeConfig(value: unknown): asserts value is RuntimeConfig {
  if (
    !isRecord(value)
    || value.schemaVersion !== 1
    || value.profile !== "web"
    || !isRecord(value.kayros)
    || "apiKey" in value.kayros
    || typeof value.kayros.apiBaseUrl !== "string"
    || typeof value.kayros.dashboardUrl !== "string"
    || value.kayros.dataType !== "provable_sdk"
    || value.kayros.table !== "s32_hashes"
  ) {
    throw new Error("Invalid web runtime config");
  }
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) {
    throw new Error(`Missing UI element: ${id}`);
  }
  return value as T;
}

function requiredRendered<T extends Element>(
  values: ReadonlyMap<string, Element>,
  id: string,
): T {
  const value = values.get(id);
  if (!value) {
    throw new Error(`Missing rendered UI element: ${id}`);
  }
  return value as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
