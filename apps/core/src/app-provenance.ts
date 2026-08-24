import type { AppReleaseManifest } from "./contracts";
import { canonicalJson, sha256Hex } from "./integrity";

export type BundledDistributionProfile = "chrome-extension-bundle" | "github-pages-bundle";

export interface AppTrustDecisionV1 {
  schemaVersion: 1;
  policyId: "provable-bundled-publishers-v1";
  distributionProfile: BundledDistributionProfile;
  authorizationBasis: "packaged-artifact";
  publisherClaim: string;
  publisherClaimStatus: "bundle-allowlisted";
  publisherSignatureStatus: "not-configured";
  executionAuthorized: true;
}

export interface AppTrustPolicy {
  readonly distributionProfile: BundledDistributionProfile;
  authorize(manifest: AppReleaseManifest): AppTrustDecisionV1;
}

/**
 * Authorizes a publisher claim because the app is inside a reviewed build artifact.
 * This deliberately does not claim that the publisher identity has a cryptographic signature.
 */
export class BundledPublisherTrustPolicy implements AppTrustPolicy {
  private readonly allowedPublishers: ReadonlySet<string>;

  constructor(
    readonly distributionProfile: BundledDistributionProfile,
    allowedPublishers: readonly string[],
  ) {
    if (allowedPublishers.length === 0) {
      throw new Error("Bundled publisher policy must allow at least one publisher claim");
    }
    this.allowedPublishers = new Set(allowedPublishers);
    if (this.allowedPublishers.size !== allowedPublishers.length) {
      throw new Error("Bundled publisher policy contains duplicate publisher claims");
    }
    for (const publisher of allowedPublishers) {
      if (publisher.trim().length === 0) {
        throw new Error("Bundled publisher policy contains an empty publisher claim");
      }
    }
  }

  authorize(manifest: AppReleaseManifest): AppTrustDecisionV1 {
    if (!this.allowedPublishers.has(manifest.publisher)) {
      throw new Error(`Publisher claim is not authorized by this bundle: ${manifest.publisher}`);
    }
    return {
      schemaVersion: 1,
      policyId: "provable-bundled-publishers-v1",
      distributionProfile: this.distributionProfile,
      authorizationBasis: "packaged-artifact",
      publisherClaim: manifest.publisher,
      publisherClaimStatus: "bundle-allowlisted",
      publisherSignatureStatus: "not-configured",
      executionAuthorized: true,
    };
  }
}

export interface AppDigestGraphV1 {
  schemaVersion: 1;
  appManifestSha256: string;
  appModuleSha256: string;
  appUiSha256: string;
  coreManifestSha256: string;
  coreModuleSha256: string;
  closureSha256: string;
}

type AppDigestGraphPayloadV1 = Omit<AppDigestGraphV1, "closureSha256">;

export async function createAppDigestGraph(
  payload: AppDigestGraphPayloadV1,
): Promise<AppDigestGraphV1> {
  assertDigestPayload(payload);
  const closureSha256 = await sha256Hex(canonicalJson(payload));
  return { ...payload, closureSha256 };
}

function assertDigestPayload(value: AppDigestGraphPayloadV1): void {
  if (value.schemaVersion !== 1) {
    throw new Error("Unsupported app digest graph version");
  }
  const expectedKeys = new Set([
    "schemaVersion",
    "appManifestSha256",
    "appModuleSha256",
    "appUiSha256",
    "coreManifestSha256",
    "coreModuleSha256",
  ]);
  const actualKeys = Object.keys(value);
  if (
    actualKeys.length !== expectedKeys.size
    || actualKeys.some((key) => !expectedKeys.has(key))
  ) {
    throw new Error("App digest graph payload has unsupported fields");
  }
  for (const [label, digest] of Object.entries(value)) {
    if (label !== "schemaVersion" && !/^[0-9a-f]{64}$/.test(String(digest))) {
      throw new Error(`Invalid digest graph value: ${label}`);
    }
  }
}
