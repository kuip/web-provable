# ADR 0002: Start with a browser-native WasmX ABI

- Status: accepted for the first vertical slice
- Date: 2026-08-23

## Decision

The first Provable runtime executes plain `wasm32-unknown-unknown` modules through the versioned `provable:app/1` ABI. The common ABI allocation, JSON-envelope, SHA3-256, and error helpers live in `apps/core/wasmx`; every app module links that crate. The matching TypeScript host lives in `apps/core/src`.

Version 1 modules have no imports and export linear memory plus:

- `provable_abi_version`
- `provable_alloc`
- `provable_dealloc`
- `provable_run`

Inputs and outputs are size-limited UTF-8 JSON. Store builds compile and package the module locally, verify its SHA-256, reject imports, and check the required exports before release and again before instantiation.

This ABI is a Provable browser contract. It is not a claim that an app is directly compatible with the full `ark-us/wasmx` engine. Any future engine integration must stay behind the shared executor contract and pass the same store-policy, isolation, determinism, and resource-limit gates.

## Evidence

The initial Prove Inclusion module:

- compiles from the Cargo workspace for `wasm32-unknown-unknown`;
- validates with `wasm-tools`;
- has zero imports;
- passes a TypeScript-to-WasmX differential integration test; and
- is re-hashed and inspected in the assembled Chrome artifact.

## Consequences and remaining work

- Common app logic has one TypeScript package and one Rust crate under `apps/core/`.
- A module cannot directly access the DOM, extension APIs, storage, network, clock, or credentials.
- The first slice runs synchronously. Moving execution into a terminable worker and enforcing memory, input, and wall-clock limits remains required before untrusted modules are allowed.
- Dynamic, downloaded modules remain outside the store profile and require the separate sandbox decision recorded in ADR 0001.
