# Provable Core

`apps/core/` is the mandatory shared dependency for Provable apps.

- `src/` exposes TypeScript app contracts, canonical hashing, Kayros adapters, and the WasmX browser ABI runner.
- `wasmx/` exposes the Rust helpers and exported ABI used by every WasmX module.
- Browser-specific APIs do not belong here; they stay under `extension/`.

An app consumes both layers:

```json
{
  "dependencies": {
    "@provable/core": "*"
  }
}
```

```toml
[dependencies]
provable-wasmx-core = { path = "../../core/wasmx" }
```
