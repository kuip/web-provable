import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { PROVE_INCLUSION_APP } from "@provable/prove-inclusion";
import { VERIFY_KAYROS_APP } from "@provable/verify-kayros";
import { assertAppReleaseManifest, type AppSourceManifest } from "../src/index";

const digest = "00".repeat(32);
const manifests = [
  {
    name: "Prove Inclusion",
    url: new URL("../../prove-inclusion/app.config.json", import.meta.url),
    source: PROVE_INCLUSION_APP,
  },
  {
    name: "Verify Kayros",
    url: new URL("../../verify-kayros/app.config.json", import.meta.url),
    source: VERIFY_KAYROS_APP,
  },
];

describe("app wire schemas", () => {
  for (const manifest of manifests) {
    it(`validates ${manifest.name} and keeps its build manifest schemas synchronized`, async () => {
      const config = JSON.parse(await readFile(manifest.url, "utf8")) as AppSourceManifest;
      const release: unknown = {
        ...config,
        module: { ...config.module, sha256: digest },
        ui: { ...config.ui, sha256: digest },
      };

      expect(() => assertAppReleaseManifest(release)).not.toThrow();
      expect(config.inputSchema).toEqual(manifest.source.inputSchema);
      expect(config.outputSchema).toEqual(manifest.source.outputSchema);
    });
  }

  it("rejects a release manifest without committed wire schemas", () => {
    expect(() => assertAppReleaseManifest({
      schemaVersion: 1,
      id: "missing-schema",
      kind: "app",
      publisher: "test:publisher",
      version: "0.1.0",
      coreVersion: "^0.1.0",
      title: "Missing schema",
      description: "Fixture without committed schemas",
      abi: "provable:app/1",
      module: { path: "app.wasm", sha256: digest },
      ui: { path: "ui.md", sha256: digest },
      fields: [],
      capabilities: {},
      resourceLimits: {
        maxInputBytes: 1,
        maxOutputBytes: 1,
        timeoutMs: 1,
        maxMemoryPages: 1,
      },
    })).toThrow("App input schema");
  });

  it("rejects unsupported manifest and nested fields", async () => {
    const release = await fixtureRelease();

    expect(() => assertAppReleaseManifest({ ...release, unexpected: true })).toThrow(
      "unsupported field: unexpected",
    );
    expect(() => assertAppReleaseManifest({
      ...release,
      module: { ...release.module, url: "https://example.test/app.wasm" },
    })).toThrow("unsupported field: url");
    expect(() => assertAppReleaseManifest({
      ...release,
      resourceLimits: { ...release.resourceLimits, retries: 3 },
    })).toThrow("unsupported field: retries");
  });

  it("validates field semantics and declared network origins", async () => {
    const release = await fixtureRelease();
    const firstField = release.fields[0];
    expect(firstField).toBeDefined();
    if (!firstField) {
      return;
    }

    expect(() => assertAppReleaseManifest({
      ...release,
      fields: [{ ...firstField, readOnly: true }, ...release.fields.slice(1)],
    })).toThrow("cannot be read-only");
    expect(() => assertAppReleaseManifest({
      ...release,
      capabilities: { networkOrigins: ["https://example.test/path"] },
    })).toThrow("invalid HTTPS origin");
    expect(() => assertAppReleaseManifest({
      ...release,
      capabilities: { networkOrigins: ["https://example.test", "https://example.test"] },
    })).toThrow("Duplicate app network origin");
  });
});

async function fixtureRelease(): Promise<ReturnType<typeof makeRelease>> {
  const config = JSON.parse(await readFile(manifests[0]!.url, "utf8")) as AppSourceManifest;
  return makeRelease(config);
}

function makeRelease(config: AppSourceManifest) {
  return {
    ...config,
    module: { ...config.module, sha256: digest },
    ui: { ...config.ui, sha256: digest },
  };
}
