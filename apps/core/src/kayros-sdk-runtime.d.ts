export interface ProveSingleHashResponse {
  success: boolean;
  hash?: string;
  timeuuid?: string;
  encoding?: string;
  error?: string;
}

export interface ProveOptions {
  apiKey?: string;
  dataType?: string;
}

export interface EnvelopeVerifyWithInclusionOverrides {
  apiKey?: string;
  data_type?: string;
  trusted_root_hash?: string;
  verify_batch_existence?: boolean;
}

export interface EnvelopeVerifyResult {
  valid: boolean;
  error?: string;
  details?: unknown;
}

export function keccak256(data: Uint8Array): string;

export function prove_single_hash(
  dataHash: string,
  options?: string | ProveOptions,
): Promise<ProveSingleHashResponse>;

export class KayrosEnvelope {
  static fromJSON(jsonText: string): KayrosEnvelope;
  getDataFormat(): string;
  getHashAlgorithm(): string;
  getData(): Uint8Array;
}

export function verifyEnvelopeWithInclusion(
  envelope: KayrosEnvelope,
  overrides?: EnvelopeVerifyWithInclusionOverrides,
): Promise<EnvelopeVerifyResult>;
