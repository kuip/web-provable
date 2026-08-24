# ADR 0002: Start with a browser-native WasmX ABI

- Status: accepted and implemented for packaged browser apps
- Date: 2026-08-23

## Decision

The first Provable runtime executes plain `wasm32-unknown-unknown` modules through the versioned `provable:app/1` ABI. The common ABI allocation, JSON-envelope, SHA3-256, and error helpers live in `apps/core/wasmx`; every app module links that crate. The matching TypeScript host lives in `apps/core/src`.

Version 1 modules have no imports and export linear memory plus:

- `provable_abi_version`
- `provable_alloc`
- `provable_dealloc`
- `provable_run`

Inputs and outputs are size-limited UTF-8 JSON and must conform to schemas committed in the app manifest. ABI 1 supports a bounded, no-reference JSON Schema subset with closed objects, homogeneous arrays, primitive types, required properties, length/item limits, and numeric ranges. Unsupported keywords, open object schemas, excessive schema depth, non-safe integers, invalid inputs, and schema-invalid outputs are rejected with structured errors. Store builds compile and package the module locally, verify its SHA-256, reject imports, and check the required exports before release and again before instantiation.

Each app module executes in a dedicated, terminable module Worker. Core transfers a private copy of the packaged bytes to that worker, which recomputes SHA-256 immediately before compiling the zero-import module. The host enforces the manifest's input, output, wall-clock, and memory limits, returns stable structured error codes, and terminates the worker on timeout, cancellation, runtime failure, or protocol failure. Every module must declare a linear-memory maximum no greater than its manifest limit; current Rust modules are linked with a 64-page (4 MiB) hard maximum. Browser hosts also reject app modules larger than 8 MiB.

This ABI is a Provable browser contract. It is not a claim that an app is directly compatible with the full `ark-us/wasmx` engine. Any future engine integration must stay behind the shared executor contract and pass the same store-policy, isolation, determinism, and resource-limit gates.

## Evidence

The packaged app modules:

- compile from the Cargo workspace for `wasm32-unknown-unknown`;
- validate with `wasm-tools`;
- have zero imports;
- pass TypeScript-to-WasmX differential integration tests;
- are re-hashed and inspected in the assembled Chrome artifact.

The worker conformance fixture additionally proves that:

- transferred bytes are re-hashed before instantiation;
- oversized inputs and outputs return structured failures;
- input values and module results that violate their committed schemas are rejected on the worker boundary;
- a module whose declared memory maximum exceeds its manifest is rejected; and
- an infinite-loop module is forcibly terminated on both timeout and cancellation.

## Consequences and remaining work

- Common app logic has one TypeScript package and one Rust crate under `apps/core/`.
- A module cannot directly access the DOM, extension APIs, storage, network, clock, or credentials.
- App WasmX execution no longer blocks the panel or page thread. A terminated worker is recreated from the retained, packaged, immutable byte copy before the next invocation.
- Local execution and diagnostic records are implemented for the current first-party workflows; signed publisher trust and the immutable module cache remain required before third-party modules are allowed.
- Dynamic, downloaded modules remain outside the store profile and require the separate sandbox decision recorded in ADR 0001.
