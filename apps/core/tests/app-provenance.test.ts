import { describe, expect, it } from "vitest";

import { PROVE_INCLUSION_APP } from "@provable/prove-inclusion";
import {
  BundledPublisherTrustPolicy,
  createAppDigestGraph,
  type AppReleaseManifest,
} from "../src/index";

const digest = "00".repeat(32);
const releaseManifest: AppReleaseManifest = {
  ...PROVE_INCLUSION_APP,
  module: { ...PROVE_INCLUSION_APP.module, sha256: digest },
  ui: { ...PROVE_INCLUSION_APP.ui, sha256: digest },
};

describe("app provenance", () => {
  it("authorizes only publisher claims pinned by the packaged profile", () => {
    const policy = new BundledPublisherTrustPolicy(
      "chrome-extension-bundle",
      ["github:kuip"],
    );

    expect(policy.authorize(releaseManifest)).toEqual({
      schemaVersion: 1,
      policyId: "provable-bundled-publishers-v1",
      distributionProfile: "chrome-extension-bundle",
      authorizationBasis: "packaged-artifact",
      publisherClaim: "github:kuip",
      publisherClaimStatus: "bundle-allowlisted",
      publisherSignatureStatus: "not-configured",
      executionAuthorized: true,
    });
    expect(() => policy.authorize({
      ...releaseManifest,
      publisher: "github:someone-else",
    })).toThrow("not authorized");
  });

  it("does not allow an empty or ambiguous bundled trust store", () => {
    expect(() => new BundledPublisherTrustPolicy("github-pages-bundle", [])).toThrow(
      "at least one",
    );
    expect(() => new BundledPublisherTrustPolicy(
      "github-pages-bundle",
      ["github:kuip", "github:kuip"],
    )).toThrow("duplicate");
  });

  it("commits the complete app and Core resource closure", async () => {
    const payload = {
      schemaVersion: 1,
      appManifestSha256: "00".repeat(32),
      appModuleSha256: "11".repeat(32),
      appUiSha256: "22".repeat(32),
      coreManifestSha256: "33".repeat(32),
      coreModuleSha256: "44".repeat(32),
    } as const;
    const graph = await createAppDigestGraph(payload);

    expect(graph.closureSha256).toMatch(/^[0-9a-f]{64}$/);
    await expect(createAppDigestGraph({
      ...payload,
      appUiSha256: "55".repeat(32),
    })).resolves.not.toMatchObject({ closureSha256: graph.closureSha256 });
  });
});
