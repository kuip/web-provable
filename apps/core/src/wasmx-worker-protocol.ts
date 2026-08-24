import type { AppResourceLimits } from "./contracts";
import type { AppJsonSchema } from "./json-schema";

export interface WasmXSerializedError {
  code: string;
  message: string;
}

export type WasmXWorkerRequest =
  | {
    type: "initialize";
    moduleBytes: ArrayBuffer;
    expectedSha256: string;
    limits: AppResourceLimits;
    inputSchema: AppJsonSchema;
    outputSchema: AppJsonSchema;
  }
  | {
    type: "run";
    requestId: number;
    inputJson: string;
  };

export type WasmXWorkerResponse =
  | { type: "ready" }
  | { type: "result"; requestId: number; value: unknown }
  | { type: "error"; requestId?: number; error: WasmXSerializedError };
