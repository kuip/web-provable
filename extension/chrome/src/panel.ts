import {
  assertAppReleaseManifest,
  sha256Hex,
  WasmXModule,
  type AppReleaseManifest,
} from "@web-provable/core";
import {
  computeProveInclusion,
  type ProveInclusionInput,
  type ProveInclusionOutput,
} from "@web-provable/prove-inclusion";

const form = requiredElement<HTMLFormElement>("prove-form");
const textA = requiredElement<HTMLTextAreaElement>("text-a");
const proofA = requiredElement<HTMLTextAreaElement>("proof-a");
const textB = requiredElement<HTMLInputElement>("text-b");
const threshold = requiredElement<HTMLInputElement>("threshold");
const countOutput = requiredElement<HTMLOutputElement>("count-output");
const resultOutput = requiredElement<HTMLOutputElement>("result-output");
const proofStatus = requiredElement<HTMLElement>("proof-status");
const moduleStatus = requiredElement<HTMLElement>("module-status");
const moduleDigest = requiredElement<HTMLElement>("module-digest");
const errorMessage = requiredElement<HTMLElement>("error-message");
const runButton = requiredElement<HTMLButtonElement>("run-button");

let runnerPromise: Promise<WasmXModule<ProveInclusionInput, ProveInclusionOutput>> | undefined;

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void runPreview();
});

for (const field of [textA, proofA, textB, threshold]) {
  field.addEventListener("input", resetResult);
}

void loadRunner().catch(showError);

async function runPreview(): Promise<void> {
  setBusy(true);
  clearError();
  try {
    const input = readInput();
    const runner = await loadRunner();
    const output = await runner.run(input);
    const reference = computeProveInclusion(input);
    if (output.count !== reference.count || output.result !== reference.result) {
      throw new Error("WasmX output did not match the core reference implementation");
    }
    countOutput.value = String(output.count);
    resultOutput.value = output.result ? "True" : "False";
    resultOutput.dataset.value = String(output.result);
    proofStatus.textContent = proofA.value.trim().length > 0
      ? "Proof supplied; Kayros verification is the next integration step."
      : "Preview only — no Kayros proof supplied or verified.";
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

async function loadRunner(): Promise<WasmXModule<ProveInclusionInput, ProveInclusionOutput>> {
  runnerPromise ??= (async () => {
    moduleStatus.textContent = "Verifying packaged module…";
    const manifestResponse = await fetch("apps/prove-inclusion/app.json");
    if (!manifestResponse.ok) {
      throw new Error(`Unable to load app manifest (${manifestResponse.status})`);
    }
    const manifestValue: unknown = await manifestResponse.json();
    assertAppReleaseManifest(manifestValue);
    const manifest: AppReleaseManifest = manifestValue;
    const moduleResponse = await fetch(`apps/prove-inclusion/${manifest.module.path}`);
    if (!moduleResponse.ok) {
      throw new Error(`Unable to load packaged WasmX module (${moduleResponse.status})`);
    }
    const bytes = new Uint8Array(await moduleResponse.arrayBuffer());
    const digest = await sha256Hex(bytes);
    if (digest !== manifest.module.sha256) {
      throw new Error("Packaged WasmX digest does not match its release manifest");
    }
    moduleDigest.textContent = digest;
    moduleStatus.textContent = "Packaged module verified";
    moduleStatus.dataset.status = "verified";
    return WasmXModule.instantiate<ProveInclusionInput, ProveInclusionOutput>(bytes, {
      maxOutputBytes: manifest.resourceLimits.maxOutputBytes,
    });
  })();
  return runnerPromise;
}

function readInput(): ProveInclusionInput {
  const n = Number(threshold.value);
  if (textA.value.length === 0) {
    throw new Error("Text A is required");
  }
  if (textB.value.length === 0) {
    throw new Error("Text B is required");
  }
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error("N must be a non-negative integer");
  }
  return { a: textA.value, b: textB.value, n };
}

function resetResult(): void {
  countOutput.value = "—";
  resultOutput.value = "—";
  delete resultOutput.dataset.value;
  proofStatus.textContent = "Not verified";
  clearError();
}

function setBusy(busy: boolean): void {
  runButton.disabled = busy;
  runButton.textContent = busy ? "Running…" : "Compute preview";
}

function showError(error: unknown): void {
  errorMessage.textContent = error instanceof Error ? error.message : String(error);
  errorMessage.hidden = false;
}

function clearError(): void {
  errorMessage.textContent = "";
  errorMessage.hidden = true;
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) {
    throw new Error(`Missing UI element: ${id}`);
  }
  return value as T;
}

