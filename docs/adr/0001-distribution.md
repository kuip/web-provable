# ADR 0001: Bundle executable apps in store releases

- Status: accepted for MVP
- Date: 2026-08-23

## Decision

Chrome and Safari store artifacts contain every executable WasmX module they can run. GitHub CI builds modules from the same checked-out revision, computes their SHA-256 values, generates release manifests, and assembles the extension artifacts. Updating a module requires a new extension release.

Downloaded-after-install modules are not part of the signed extension package even when cached locally. Dynamic modules are deferred until they can execute through a reviewed sandbox or native runtime profile.

The bundled resolver accepts only redirect-free URLs below the artifact root. It validates a closed manifest contract, checks the first-party publisher claim against the build profile, hashes the manifest, UI, app module, Core manifest, and Core module, and commits that closure to one digest. Only after every declared digest matches does it promote exact bytes into an immutable SHA-256-keyed IndexedDB cache. It reads executable bytes back from that cache, re-hashes them, and then instantiates them. Cache corruption therefore blocks execution.

The current publisher authorization is deliberately labeled `packaged-artifact`: it trusts the reviewed and platform-signed bundle, not a cryptographic signature made by the publisher named in `app.json`. Publisher signing, rotation, and revocation remain unresolved until the key policy is frozen. Caching never authorizes remotely obtained executable code in a store extension.

## Consequences

- The executed module maps to extension bytes, a Git revision, and a Kayros execution record.
- Store releases avoid remote-hosted-code ambiguity.
- App updates follow browser-store update cadence.
- Resolver and executor interfaces remain source-agnostic so a future dynamic sandbox can reuse the same integrity and record formats.
- The local cache improves repeatability and exposes corruption; it is not a remote-code-policy workaround.
- Provenance UI distinguishes a bundle-authorized publisher claim from a cryptographically signed publisher identity.
