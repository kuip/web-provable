import {
  findKayrosRecordByHash,
  findKayrosRecordBySha3,
  findKayrosRecordsByDataItem,
  getLatestKayrosHash,
  loadVerifiedBrowserApp,
  normalizeKayrosApiKey,
  observeBrowserHeaderHeight,
  renderBrowserMarkdownForm,
  type AppExecutor,
  type AppReleaseManifest,
  type KayrosConnectionOptions,
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
  profile: "development" | "store";
  kayros: {
    apiBaseUrl: string;
    dashboardUrl: string;
    apiKey: string;
    dataType: string;
    table: "s32_hashes";
  };
}

interface LoadedApp {
  config: RuntimeConfig;
  kayrosApiKey: string;
  kayrosApiKeySource: "config" | "stored" | "unset";
  manifest: AppReleaseManifest;
  markdown: string;
  runner: AppExecutor<ProveInclusionInput, ProveInclusionOutput>;
  sha3: WasmXSha3Module;
}

interface LoadedVerifyKayrosApp {
  manifest: AppReleaseManifest;
  markdown: string;
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
const errorMessage = requiredElement<HTMLElement>("error-message");
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
const verifyKayrosIntegrity = requiredElement<HTMLElement>("verify-kayros-integrity");
const verifyKayrosModuleStatus = requiredElement<HTMLElement>("verify-kayros-module-status");
const verifyKayrosModuleDigest = requiredElement<HTMLElement>("verify-kayros-module-digest");
const verifyKayrosUiDigest = requiredElement<HTMLElement>("verify-kayros-ui-digest");
const verifyKayrosCoreDigest = requiredElement<HTMLElement>("verify-kayros-core-digest");

const KAYROS_API_KEY_STORAGE_KEY = "provable.kayrosApiKey";
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
clearKayrosApiKeyButton.addEventListener("click", () => {
  void clearKayrosApiKey();
});
kayrosApiKeyInput.addEventListener("input", () => {
  kayrosApiKeyStatus.textContent = "Unsaved API key change";
  delete kayrosApiKeyStatus.dataset.status;
});
showSelectedView();
void initializeProveInclusion().catch(showLoadError);

async function initializeProveInclusion(): Promise<void> {
  const loaded = await loadPackagedApps();
  loadedApp = loaded.proveInclusion;
  kayrosDashboardLink.href = loaded.proveInclusion.config.kayros.dashboardUrl;
  configureKayrosSettings(loaded.proveInclusion);
  const controls = renderAppTemplate(
    loaded.proveInclusion.markdown,
    loaded.proveInclusion.manifest,
  );
  const verifyControls = renderVerifyKayrosTemplate(
    loaded.verifyKayros.markdown,
    loaded.verifyKayros.manifest,
  );

  controls.form.addEventListener("submit", (event) => {
    event.preventDefault();
    void runPreview(loaded.proveInclusion, controls);
  });
  for (const field of [
    controls.textA,
    controls.textB,
    controls.threshold,
  ]) {
    field.addEventListener("input", () => resetResult(controls));
  }
  verifyControls.form.addEventListener("submit", (event) => {
    event.preventDefault();
    void runVerifyKayrosPreview(
      loaded.proveInclusion,
      loaded.verifyKayros,
      verifyControls,
    );
  });
  for (const field of [verifyControls.recordHash, verifyControls.dataItem]) {
    field.addEventListener("input", () => resetVerifyKayrosResult(verifyControls));
  }

  appContent.ariaBusy = "false";
  verifyKayrosContent.ariaBusy = "false";
  if (viewSelector.value === "core") {
    void refreshLatestKayros();
  }
}

async function loadPackagedApps(): Promise<{
  proveInclusion: LoadedApp;
  verifyKayros: LoadedVerifyKayrosApp;
}> {
  moduleStatus.textContent = "Verifying packaged UI, app module, and core module…";
  verifyKayrosModuleStatus.textContent = "Verifying packaged UI, app module, and core module…";
  const [verified, verifyKayros, configResponse] = await Promise.all([
    loadVerifiedBrowserApp<ProveInclusionInput, ProveInclusionOutput>({
      appManifestUrl: "apps/prove-inclusion/app.json",
      coreManifestUrl: "apps/core/app.json",
      workerUrl: chrome.runtime.getURL("wasmx-worker.js"),
    }),
    loadVerifiedBrowserApp<VerifyKayrosModuleInput, VerifyKayrosOutput>({
      appManifestUrl: "apps/verify-kayros/app.json",
      coreManifestUrl: "apps/core/app.json",
      workerUrl: chrome.runtime.getURL("wasmx-worker.js"),
    }),
    fetch("config.json"),
  ]);
  assertResponse(configResponse, "runtime config");

  const configValue: unknown = await configResponse.json();
  assertRuntimeConfig(configValue);
  const config: RuntimeConfig = configValue;
  const kayrosSettings = await resolveKayrosApiKey(config.kayros.apiKey);

  moduleDigest.textContent = verified.moduleDigest;
  uiDigest.textContent = verified.uiDigest;
  coreModuleDigest.textContent = verified.coreDigest;
  moduleStatus.textContent = "Packaged UI and modules verified";
  moduleStatus.dataset.status = "verified";
  verifyKayrosModuleDigest.textContent = verifyKayros.moduleDigest;
  verifyKayrosUiDigest.textContent = verifyKayros.uiDigest;
  verifyKayrosCoreDigest.textContent = verifyKayros.coreDigest;
  verifyKayrosModuleStatus.textContent = "Packaged UI and modules verified";
  verifyKayrosModuleStatus.dataset.status = "verified";
  return {
    proveInclusion: {
      config,
      kayrosApiKey: kayrosSettings.apiKey,
      kayrosApiKeySource: kayrosSettings.source,
      manifest: verified.manifest,
      markdown: verified.markdown,
      runner: verified.runner,
      sha3: verified.sha3,
    },
    verifyKayros: {
      manifest: verifyKayros.manifest,
      markdown: verifyKayros.markdown,
      runner: verifyKayros.runner,
      sha3: verifyKayros.sha3,
    },
  };
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
  try {
    const workflow = await runVerifyKayrosWorkflow(readVerifyKayrosLookup(controls), {
      findByRecordHash: (recordHash) => findKayrosRecordByHash(
        recordHash,
        kayrosConnection(runtime),
        runtime.config.kayros.dataType,
      ),
      findByDataItem: (dataItem) => findKayrosRecordsByDataItem(
        dataItem,
        kayrosConnection(runtime),
        runtime.config.kayros.dataType,
      ),
      run: async (moduleInput) => {
        const inputBytes = new TextEncoder().encode(JSON.stringify(moduleInput));
        if (inputBytes.byteLength > app.manifest.resourceLimits.maxInputBytes) {
          throw new Error("Kayros record exceeds the app input limit");
        }
        return app.runner.run(moduleInput);
      },
      sha3_256: (bytes) => app.sha3.sha3_256(bytes),
    });

    if (workflow.status === "not-found") {
      setOutput(controls.lookupStatus, "Not found");
      throw new Error(`No ${workflow.lookupKind} record was found in Kayros`);
    }
    if (workflow.status === "ambiguous") {
      setOutput(controls.lookupStatus, `Ambiguous (${workflow.count} records)`);
      throw new Error(
        `The data item matches ${workflow.count} Kayros records. Search by a record hash instead.`,
      );
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

async function runPreview(loaded: LoadedApp, controls: ProveControls): Promise<void> {
  setBusy(controls, true);
  clearError();
  try {
    const input = readInput(controls);
    const inputBytes = new TextEncoder().encode(JSON.stringify(input));
    if (inputBytes.byteLength > loaded.manifest.resourceLimits.maxInputBytes) {
      throw new Error("Input exceeds the app limit");
    }

    const workflow = await runProveInclusionWorkflow(input, {
      sha3_256: (value) => loaded.sha3.sha3_256(value),
      findNotarization: (contentHash) => findKayrosRecordBySha3(
        contentHash,
        kayrosConnection(loaded),
        loaded.config.kayros.dataType,
      ),
      run: (workflowInput) => loaded.runner.run(workflowInput),
    });
    setOutput(controls.contentHashOutput, workflow.contentHash);

    if (workflow.status === "lookup-error") {
      setOutput(controls.kayrosMatchOutput, "Unavailable");
      delete controls.kayrosMatchOutput.dataset.value;
      throw new Error(`Kayros lookup failed: ${workflow.error}. The inclusion count was not run.`);
    }
    if (workflow.status === "not-found") {
      setBooleanOutput(controls.kayrosMatchOutput, false);
      throw new Error(
        `SHA3-256 of A was not found in Kayros ${loaded.config.kayros.table} for ${loaded.config.kayros.dataType}. The inclusion count was not run.`,
      );
    }

    setBooleanOutput(controls.kayrosMatchOutput, true);
    setOutput(controls.kayrosTimestampOutput, workflow.record.timestamp);
    setOutput(controls.kayrosBlockOutput, String(workflow.record.block));
    setOutput(controls.countOutput, String(workflow.output.count));
    setBooleanOutput(controls.resultOutput, workflow.output.result);
  } catch (error) {
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
}

function resetVerifyKayrosResult(controls: VerifyKayrosControls): void {
  for (const output of verifyKayrosOutputs(controls)) {
    setOutput(output, "—");
    delete output.dataset.value;
  }
  clearVerifyKayrosError();
}

function showSelectedView(): void {
  const showCore = viewSelector.value === "core";
  const showProveInclusion = viewSelector.value === "prove-inclusion";
  coreView.hidden = !showCore;
  proveInclusionView.hidden = !showProveInclusion;
  verifyKayrosView.hidden = viewSelector.value !== "verify-kayros";
  if (showCore && loadedApp) {
    void refreshLatestKayros();
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

function kayrosConnection(loaded: LoadedApp): KayrosConnectionOptions {
  return {
    apiKey: loaded.kayrosApiKey,
    baseUrl: loaded.config.kayros.apiBaseUrl,
  };
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
  kayrosApiKeyStatus.textContent = loaded.kayrosApiKeySource === "stored"
    ? "API key saved in this browser profile"
    : "Development API key loaded; save it to retain a browser setting";
  kayrosApiKeyStatus.dataset.status = "verified";
}

async function saveKayrosApiKey(): Promise<void> {
  if (!loadedApp) {
    return;
  }
  try {
    const apiKey = normalizeKayrosApiKey(kayrosApiKeyInput.value);
    await writeStoredKayrosApiKey(apiKey);
    loadedApp.kayrosApiKey = apiKey;
    loadedApp.kayrosApiKeySource = "stored";
    latestKayrosLoaded = false;
    kayrosApiKeyStatus.textContent = "API key saved in this browser profile";
    kayrosApiKeyStatus.dataset.status = "verified";
    if (viewSelector.value === "core") {
      await refreshLatestKayros(true);
    }
  } catch (error) {
    kayrosApiKeyStatus.textContent = formatError(error);
    kayrosApiKeyStatus.dataset.status = "invalid";
  }
}

async function clearKayrosApiKey(): Promise<void> {
  if (!loadedApp) {
    return;
  }
  try {
    await writeStoredKayrosApiKey("");
    loadedApp.kayrosApiKey = "";
    loadedApp.kayrosApiKeySource = "stored";
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

async function resolveKayrosApiKey(
  configApiKey: string,
): Promise<{ apiKey: string; source: LoadedApp["kayrosApiKeySource"] }> {
  const stored = await readStoredKayrosApiKey();
  if (stored !== undefined) {
    return { apiKey: stored, source: "stored" };
  }
  if (configApiKey.length > 0) {
    return { apiKey: configApiKey, source: "config" };
  }
  return { apiKey: "", source: "unset" };
}

async function readStoredKayrosApiKey(): Promise<string | undefined> {
  if (hasChromeStorage()) {
    const values = await chrome.storage.local.get(KAYROS_API_KEY_STORAGE_KEY);
    const value = values[KAYROS_API_KEY_STORAGE_KEY];
    return typeof value === "string" ? value : undefined;
  }
  const value = localStorage.getItem(KAYROS_API_KEY_STORAGE_KEY);
  return value === null ? undefined : value;
}

async function writeStoredKayrosApiKey(value: string): Promise<void> {
  if (hasChromeStorage()) {
    await chrome.storage.local.set({ [KAYROS_API_KEY_STORAGE_KEY]: value });
    return;
  }
  localStorage.setItem(KAYROS_API_KEY_STORAGE_KEY, value);
}

function hasChromeStorage(): boolean {
  return typeof chrome !== "undefined" && chrome.storage?.local !== undefined;
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
    || (value.profile !== "development" && value.profile !== "store")
    || !isRecord(value.kayros)
    || typeof value.kayros.apiBaseUrl !== "string"
    || typeof value.kayros.dashboardUrl !== "string"
    || typeof value.kayros.apiKey !== "string"
    || typeof value.kayros.dataType !== "string"
    || value.kayros.table !== "s32_hashes"
  ) {
    throw new Error("Invalid runtime config");
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
