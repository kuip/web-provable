import {
  assertAppReleaseManifest,
  findKayrosRecordBySha3,
  getLatestKayrosHash,
  normalizeKayrosApiKey,
  parseMarkdownTemplate,
  sha256Hex,
  WasmXModule,
  WasmXSha3Module,
  type AppFieldDefinition,
  type AppReleaseManifest,
  type KayrosConnectionOptions,
  type MarkdownInline,
} from "@provable/core";
import {
  computeProveInclusion,
  type ProveInclusionInput,
  type ProveInclusionOutput,
} from "@provable/prove-inclusion";

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

interface CoreReleaseManifest {
  id: "core";
  version: string;
  module: {
    path: string;
    sha256: string;
  };
}

interface LoadedApp {
  config: RuntimeConfig;
  kayrosApiKey: string;
  kayrosApiKeySource: "config" | "stored" | "unset";
  manifest: AppReleaseManifest;
  markdown: string;
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

const textDecoder = new TextDecoder("utf-8", { fatal: true });
const KAYROS_API_KEY_STORAGE_KEY = "provable.kayrosApiKey";
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
  const loaded = await loadPackagedApp();
  loadedApp = loaded;
  kayrosDashboardLink.href = loaded.config.kayros.dashboardUrl;
  configureKayrosSettings(loaded);
  const controls = renderAppTemplate(loaded.markdown, loaded.manifest);

  controls.form.addEventListener("submit", (event) => {
    event.preventDefault();
    void runPreview(loaded, controls);
  });
  for (const field of [
    controls.textA,
    controls.textB,
    controls.threshold,
  ]) {
    field.addEventListener("input", () => resetResult(controls));
  }

  appContent.ariaBusy = "false";
  if (viewSelector.value === "core") {
    void refreshLatestKayros();
  }
}

async function loadPackagedApp(): Promise<LoadedApp> {
  moduleStatus.textContent = "Verifying packaged UI, app module, and core module…";
  const [manifestResponse, coreManifestResponse, configResponse] = await Promise.all([
    fetch("apps/prove-inclusion/app.json"),
    fetch("apps/core/app.json"),
    fetch("config.json"),
  ]);
  assertResponse(manifestResponse, "app manifest");
  assertResponse(coreManifestResponse, "core manifest");
  assertResponse(configResponse, "runtime config");

  const [manifestValue, coreManifestValue, configValue]: unknown[] = await Promise.all([
    manifestResponse.json(),
    coreManifestResponse.json(),
    configResponse.json(),
  ]);
  assertAppReleaseManifest(manifestValue);
  assertCoreReleaseManifest(coreManifestValue);
  assertRuntimeConfig(configValue);
  const manifest: AppReleaseManifest = manifestValue;
  const coreManifest: CoreReleaseManifest = coreManifestValue;
  const config: RuntimeConfig = configValue;
  const kayrosSettings = await resolveKayrosApiKey(config.kayros.apiKey);

  const [moduleResponse, uiResponse, coreModuleResponse] = await Promise.all([
    fetch(`apps/prove-inclusion/${manifest.module.path}`),
    fetch(`apps/prove-inclusion/${manifest.ui.path}`),
    fetch(`apps/core/${coreManifest.module.path}`),
  ]);
  assertResponse(moduleResponse, "packaged WasmX module");
  assertResponse(uiResponse, "packaged UI template");
  assertResponse(coreModuleResponse, "packaged core WasmX module");

  const [moduleBytes, uiBytes, coreModuleBytes] = await Promise.all([
    responseBytes(moduleResponse),
    responseBytes(uiResponse),
    responseBytes(coreModuleResponse),
  ]);
  const [actualModuleDigest, actualUiDigest, actualCoreDigest] = await Promise.all([
    sha256Hex(moduleBytes),
    sha256Hex(uiBytes),
    sha256Hex(coreModuleBytes),
  ]);
  assertDigest(actualModuleDigest, manifest.module.sha256, "WasmX");
  assertDigest(actualUiDigest, manifest.ui.sha256, "UI");
  assertDigest(actualCoreDigest, coreManifest.module.sha256, "core WasmX");

  const [runner, sha3] = await Promise.all([
    WasmXModule.instantiate<ProveInclusionInput, ProveInclusionOutput>(moduleBytes, {
      maxOutputBytes: manifest.resourceLimits.maxOutputBytes,
    }),
    WasmXSha3Module.instantiate(coreModuleBytes),
  ]);

  moduleDigest.textContent = actualModuleDigest;
  uiDigest.textContent = actualUiDigest;
  coreModuleDigest.textContent = actualCoreDigest;
  moduleStatus.textContent = "Packaged UI and modules verified";
  moduleStatus.dataset.status = "verified";
  return {
    config,
    kayrosApiKey: kayrosSettings.apiKey,
    kayrosApiKeySource: kayrosSettings.source,
    manifest,
    markdown: textDecoder.decode(uiBytes),
    runner,
    sha3,
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
  const fields = new Map(manifest.fields.map((field) => [field.id, field]));
  const renderedFields = new Set<string>();
  const form = document.createElement("form");
  form.id = "prove-form";
  let renderedRunAction = false;

  for (const block of parseMarkdownTemplate(markdown)) {
    if (block.kind === "heading") {
      const heading = document.createElement(`h${block.level}`);
      appendInline(heading, block.children, fields, renderedFields);
      form.append(heading);
      continue;
    }
    if (block.kind === "paragraph") {
      const paragraph = document.createElement("p");
      appendInline(paragraph, block.children, fields, renderedFields);
      form.append(paragraph);
      continue;
    }
    if (block.kind === "field") {
      form.append(renderField(requireField(fields, block.id), renderedFields));
      continue;
    }
    if (block.id !== "run" || renderedRunAction) {
      throw new Error(`Unsupported or duplicate app action: ${block.id}`);
    }
    const button = document.createElement("button");
    button.id = "run-button";
    button.type = "submit";
    button.textContent = "Verify A and count B";
    form.append(button);
    renderedRunAction = true;
  }

  for (const field of manifest.fields) {
    if (!renderedFields.has(field.id)) {
      throw new Error(`UI template is missing declared field: ${field.id}`);
    }
  }
  if (!renderedRunAction) {
    throw new Error("UI template is missing the run action");
  }

  appContent.replaceChildren(form);
  return {
    form,
    textA: requiredDescendant<HTMLTextAreaElement>(form, "#field-a"),
    textB: requiredDescendant<HTMLInputElement>(form, "#field-b"),
    threshold: requiredDescendant<HTMLInputElement>(form, "#field-n"),
    contentHashOutput: requiredDescendant<HTMLOutputElement>(form, "#field-contentHash"),
    kayrosMatchOutput: requiredDescendant<HTMLOutputElement>(form, "#field-kayrosMatch"),
    kayrosTimestampOutput: requiredDescendant<HTMLOutputElement>(form, "#field-kayrosTimestamp"),
    kayrosBlockOutput: requiredDescendant<HTMLOutputElement>(form, "#field-kayrosBlock"),
    countOutput: requiredDescendant<HTMLOutputElement>(form, "#field-count"),
    resultOutput: requiredDescendant<HTMLOutputElement>(form, "#field-result"),
    runButton: requiredDescendant<HTMLButtonElement>(form, "#run-button"),
  };
}

function renderField(
  field: AppFieldDefinition,
  renderedFields: Set<string>,
): HTMLElement {
  markFieldRendered(field, renderedFields);
  return field.role === "output" ? renderOutput(field) : renderInput(field);
}

function renderInput(field: AppFieldDefinition): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "field-group";

  const label = document.createElement("label");
  label.htmlFor = `field-${field.id}`;
  label.textContent = field.label;
  wrapper.append(label);

  let control: HTMLInputElement | HTMLTextAreaElement;
  if (field.type === "proof" || (field.type === "text" && field.id === "a")) {
    const textarea = document.createElement("textarea");
    textarea.rows = field.type === "proof" ? 4 : 7;
    control = textarea;
  } else {
    const input = document.createElement("input");
    input.type = field.type === "integer"
      ? "number"
      : field.type === "boolean"
        ? "checkbox"
        : "text";
    if (field.type === "integer") {
      input.min = "0";
      input.step = "1";
    }
    control = input;
  }

  control.id = `field-${field.id}`;
  control.name = field.id;
  if (field.required && field.type !== "proof") {
    control.required = true;
  }
  if (field.default !== undefined) {
    if (control instanceof HTMLInputElement && control.type === "checkbox") {
      control.checked = Boolean(field.default);
    } else {
      control.value = String(field.default);
    }
  }
  control.placeholder = inputPlaceholder(field);
  wrapper.append(control);

  if (field.type === "proof") {
    const status = document.createElement("p");
    status.id = "proof-status";
    status.className = "field-status";
    status.setAttribute("aria-live", "polite");
    status.textContent = "Not verified";
    wrapper.append(status);
  }
  return wrapper;
}

function renderOutput(field: AppFieldDefinition): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "output-field";
  wrapper.dataset.field = field.id;

  const label = document.createElement("span");
  label.textContent = field.label;
  const output = document.createElement("output");
  output.id = `field-${field.id}`;
  setOutput(output, "—");
  wrapper.append(label, output);
  return wrapper;
}

function appendInline(
  parent: HTMLElement,
  children: MarkdownInline[],
  fields: Map<string, AppFieldDefinition>,
  renderedFields: Set<string>,
): void {
  for (const child of children) {
    if (child.kind === "text") {
      parent.append(document.createTextNode(child.value));
    } else if (child.kind === "strong") {
      const strong = document.createElement("strong");
      strong.textContent = child.value;
      parent.append(strong);
    } else if (child.kind === "code") {
      const code = document.createElement("code");
      code.className = "inline-code";
      code.textContent = child.value;
      parent.append(code);
    } else {
      const field = requireField(fields, child.id);
      if (field.role !== "output") {
        throw new Error(`Input field must use a standalone placeholder: ${field.id}`);
      }
      markFieldRendered(field, renderedFields);
      const output = document.createElement("output");
      output.id = `field-${field.id}`;
      setOutput(output, "—");
      parent.append(output);
    }
  }
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

    const contentHash = loaded.sha3.sha3_256(input.a);
    setOutput(controls.contentHashOutput, contentHash);

    let record;
    try {
      record = await findKayrosRecordBySha3(
        contentHash,
        kayrosConnection(loaded),
        loaded.config.kayros.dataType,
      );
    } catch (error) {
      setOutput(controls.kayrosMatchOutput, "Unavailable");
      delete controls.kayrosMatchOutput.dataset.value;
      throw new Error(`Kayros lookup failed: ${formatError(error)}. The inclusion count was not run.`);
    }

    if (!record) {
      setBooleanOutput(controls.kayrosMatchOutput, false);
      throw new Error(
        `SHA3-256 of A was not found in Kayros ${loaded.config.kayros.table} for ${loaded.config.kayros.dataType}. The inclusion count was not run.`,
      );
    }

    setBooleanOutput(controls.kayrosMatchOutput, true);
    setOutput(controls.kayrosTimestampOutput, record.timestamp);
    setOutput(controls.kayrosBlockOutput, String(record.block));

    const output = await loaded.runner.run(input);
    const reference = computeProveInclusion(input);
    if (output.count !== reference.count || output.result !== reference.result) {
      throw new Error("WasmX output did not match the core reference implementation");
    }
    setOutput(controls.countOutput, String(output.count));
    setBooleanOutput(controls.resultOutput, output.result);
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

function inputPlaceholder(field: AppFieldDefinition): string {
  if (field.id === "a") {
    return "Text whose SHA3-256 should be recorded by Kayros";
  }
  if (field.id === "b") {
    return "Text to find";
  }
  if (field.id === "n") {
    return "0 (default)";
  }
  return "";
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

async function responseBytes(response: Response): Promise<Uint8Array> {
  return new Uint8Array(await response.arrayBuffer());
}

function assertDigest(actual: string, expected: string, label: string): void {
  if (actual !== expected) {
    throw new Error(`Packaged ${label} digest does not match its release manifest`);
  }
}

function assertCoreReleaseManifest(value: unknown): asserts value is CoreReleaseManifest {
  if (
    !isRecord(value)
    || value.id !== "core"
    || typeof value.version !== "string"
    || !isRecord(value.module)
    || typeof value.module.path !== "string"
    || typeof value.module.sha256 !== "string"
    || !/^[0-9a-f]{64}$/.test(value.module.sha256)
  ) {
    throw new Error("Invalid core release manifest");
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

function requireField(
  fields: Map<string, AppFieldDefinition>,
  id: string,
): AppFieldDefinition {
  const field = fields.get(id);
  if (!field) {
    throw new Error(`UI template references an undeclared field: ${id}`);
  }
  return field;
}

function markFieldRendered(field: AppFieldDefinition, renderedFields: Set<string>): void {
  if (renderedFields.has(field.id)) {
    throw new Error(`UI template renders a field more than once: ${field.id}`);
  }
  renderedFields.add(field.id);
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) {
    throw new Error(`Missing UI element: ${id}`);
  }
  return value as T;
}

function requiredDescendant<T extends Element>(root: ParentNode, selector: string): T {
  const value = root.querySelector(selector);
  if (!value) {
    throw new Error(`Missing rendered UI element: ${selector}`);
  }
  return value as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
