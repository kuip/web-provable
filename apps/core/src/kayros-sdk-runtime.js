// The Kayros packages currently publish TypeScript source as their npm entry points.
// Keep that implementation behind a JavaScript boundary so the extension bundler can
// include it while the workspace compiler checks only the stable surface declared in
// kayros-sdk-runtime.d.ts.
export { keccak256, prove_single_hash } from "@kuip/provable-sdk";
export { KayrosEnvelope, verifyEnvelopeWithInclusion } from "@kuip/provable-proof";
