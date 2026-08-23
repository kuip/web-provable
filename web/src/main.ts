import {
  findKayrosRecordBySha3,
  getLatestKayrosHash,
  loadVerifiedBrowserApp,
  normalizeKayrosApiKey,
  renderBrowserMarkdownForm,
  type AppReleaseManifest,
  type KayrosConnectionOptions,
  type WasmXModule,
  type WasmXSha3Module,
} from "@provable/core";
import {
  runProveInclusionWorkflow,
  type ProveInclusionInput,
  type ProveInclusionOutput,
} from "@provable/prove-inclusion";

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
  manifest: AppReleaseManifest;
  runner: WasmXModule<ProveInclusionInput, ProveInclusionOutput>;
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

const viewSelector = requiredElement<HTMLSelectElement>("view-selector");
const coreView = requiredElement<HTMLElement>("core-view");
const proveInclusionView = requiredElement<HTMLElement>("prove-inclusion-view");
const appContent = requiredElement<HTMLElement>("app-content");
const moduleStatus = requiredElement<HTMLElement>("module-status");
const moduleDigest = requiredElement<HTMLElement>("module-digest");
const uiDigest = requiredElement<HTMLElement>("ui-digest");
const coreModuleDigest = requiredElement<HTMLElement>("core-module-digest");
const errorMessage = requiredElement<HTMLElement>("error-message");
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

const KAYROS_API_KEY_STORAGE_KEY = "provable.web.kayrosApiKey";
const MAX_URL_FRAGMENT_LENGTH = 1_500_000;
let loadedApp: LoadedApp | undefined;
let latestKayrosLoaded = false;

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
  const [verified, configResponse] = await Promise.all([
    loadVerifiedBrowserApp<ProveInclusionInput, ProveInclusionOutput>({
      appManifestUrl: "./apps/prove-inclusion/app.json",
      coreManifestUrl: "./apps/core/app.json",
    }),
    fetch("./config.json"),
  ]);
  assertResponse(configResponse, "runtime config");
  const configValue: unknown = await configResponse.json();
  assertRuntimeConfig(configValue);

  const loaded: LoadedApp = {
    config: configValue,
    kayrosApiKey: readStoredKayrosApiKey(),
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
  moduleStatus.textContent = "Packaged UI and modules verified";
  moduleStatus.dataset.status = "verified";

  const controls = renderAppTemplate(verified.markdown, verified.manifest);
  controls.form.addEventListener("submit", (event) => {
    event.preventDefault();
    void runPreview(loaded, controls);
  });
  for (const field of [controls.textA, controls.textB, controls.threshold]) {
    field.addEventListener("input", () => resetResult(controls));
  }
  applyUrlPrefill(controls);

  appContent.ariaBusy = "false";
  if (viewSelector.value === "core") {
    void refreshLatestKayros();
  }
}

function renderAppTemplate(markdown: string, manifest: AppReleaseManifest): ProveControls {
  const rendered = renderBrowserMarkdownForm(markdown, manifest, {
    actionLabels: { run: "Verify A and count B" },
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

function applyUrlPrefill(controls: ProveControls): void {
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
    if (parameters.get("app") !== "prove-inclusion") {
      throw new Error("Unsupported Provable URL application");
    }

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

    viewSelector.value = "prove-inclusion";
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
}

function showSelectedView(): void {
  const showCore = viewSelector.value === "core";
  coreView.hidden = !showCore;
  proveInclusionView.hidden = showCore;
  if (showCore && loadedApp) {
    void refreshLatestKayros();
  }
}

function setBusy(controls: ProveControls, busy: boolean): void {
  controls.runButton.disabled = busy;
  controls.runButton.textContent = busy ? "Verifying A…" : "Verify A and count B";
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
  moduleStatus.textContent = "Integrity verification failed";
  moduleStatus.dataset.status = "invalid";
  showError(error);
}

function showError(error: unknown): void {
  errorMessage.textContent = formatError(error);
  errorMessage.hidden = false;
}

function clearError(): void {
  errorMessage.textContent = "";
  errorMessage.hidden = true;
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
