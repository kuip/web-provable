import {
  KayrosEnvelope,
  keccak256,
  prove_single_hash,
  verifyEnvelopeWithInclusion,
  type EnvelopeVerifyWithInclusionOverrides,
  type ProveOptions,
  type ProveSingleHashResponse,
} from "./kayros-sdk-runtime.js";

import { equalBytes, hexToBytes, sha256Hex } from "./integrity";

export const DEFAULT_KAYROS_DATA_TYPE = "web_provable_v1";

export interface KayrosRequestOptions {
  apiKey?: string;
  dataType?: string;
}

export interface KayrosInclusionOptions extends KayrosRequestOptions {
  trustedRootHash?: string;
  verifyBatchExistence?: boolean;
}

export interface KayrosNotarization {
  dataHash: string;
  response: ProveSingleHashResponse;
}

export interface KayrosVerification {
  valid: boolean;
  error?: string;
  details?: unknown;
}

export async function notarizeBytes(
  bytes: Uint8Array,
  options: KayrosRequestOptions = {},
): Promise<KayrosNotarization> {
  const dataHash = await sha256Hex(bytes);
  const requestOptions: ProveOptions = {
    dataType: options.dataType ?? DEFAULT_KAYROS_DATA_TYPE,
  };
  if (options.apiKey !== undefined) {
    requestOptions.apiKey = options.apiKey;
  }
  const response = await prove_single_hash(dataHash, requestOptions);
  if (!response.success || !response.hash) {
    throw new Error(response.error ?? "Kayros did not return a proof hash");
  }
  return { dataHash, response };
}

export async function verifyEnvelopeForBytes(
  proofJson: string,
  expectedBytes: Uint8Array,
  options: KayrosInclusionOptions = {},
): Promise<KayrosVerification> {
  let envelope: KayrosEnvelope;
  try {
    envelope = KayrosEnvelope.fromJSON(proofJson);
  } catch (error) {
    return { valid: false, error: errorMessage(error) };
  }

  const payloadMatches = await envelopeMatches(envelope, expectedBytes);
  if (!payloadMatches) {
    return { valid: false, error: "Kayros proof payload does not match the expected bytes" };
  }

  const verificationOptions: EnvelopeVerifyWithInclusionOverrides = {
    data_type: options.dataType ?? DEFAULT_KAYROS_DATA_TYPE,
  };
  if (options.apiKey !== undefined) {
    verificationOptions.apiKey = options.apiKey;
  }
  if (options.trustedRootHash !== undefined) {
    verificationOptions.trusted_root_hash = options.trustedRootHash;
  }
  if (options.verifyBatchExistence !== undefined) {
    verificationOptions.verify_batch_existence = options.verifyBatchExistence;
  }

  const verification = await verifyEnvelopeWithInclusion(envelope, verificationOptions);

  const result: KayrosVerification = {
    valid: verification.valid,
  };
  if (verification.error !== undefined) {
    result.error = verification.error;
  }
  if (verification.details !== undefined) {
    result.details = verification.details;
  }
  return result;
}

async function envelopeMatches(envelope: KayrosEnvelope, expectedBytes: Uint8Array): Promise<boolean> {
  if (envelope.getDataFormat() !== "raw_hash") {
    return equalBytes(envelope.getData(), expectedBytes);
  }
  const expectedHash = envelope.getHashAlgorithm() === "keccak256"
    ? keccak256(expectedBytes)
    : await sha256Hex(expectedBytes);
  return equalBytes(envelope.getData(), hexToBytes(expectedHash));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
