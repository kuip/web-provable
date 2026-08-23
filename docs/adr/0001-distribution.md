# ADR 0001: Bundle executable apps in store releases

- Status: accepted for MVP
- Date: 2026-08-23

## Decision

Chrome and Safari store artifacts contain every executable WasmX module they can run. GitHub CI builds modules from the same checked-out revision, computes their SHA-256 values, generates release manifests, and assembles the extension artifacts. Updating a module requires a new extension release.

Downloaded-after-install modules are not part of the signed extension package even when cached locally. Dynamic modules are deferred until they can execute through a reviewed sandbox or native runtime profile.

## Consequences

- The executed module maps to extension bytes, a Git revision, and a Kayros execution record.
- Store releases avoid remote-hosted-code ambiguity.
- App updates follow browser-store update cadence.
- Resolver and executor interfaces remain source-agnostic so a future dynamic sandbox can reuse the same integrity and record formats.

