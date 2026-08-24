# Provable Core

`apps/core/` is the mandatory shared dependency for Provable apps.

- `src/` exposes TypeScript app contracts, canonical hashing, Kayros adapters, a bounded JSON Schema validator, and the dedicated-worker WasmX browser runner with digest, schema, byte, time, cancellation, and memory enforcement.
- `wasmx/` exposes the Rust helpers and exported ABI used by every WasmX module.
- Shared browser rendering and verified-resource loading belong here; platform-specific storage, navigation, and packaging stay under `web/` or `extension/`.

## UI Markdown tabs

Every app `ui.md` is rendered as tabs by the shared browser renderer. A line containing six or more hyphens separates tabs, and every tab starts with a level-one heading that supplies its label:

```md
# Application

Application fields and actions.

------

# Documentation & guide

## Chapter

### Subchapter

#### Subsubchapter
```

The final tab is the documentation tab and is represented visually by an open-book icon. Its level-two through level-six headings become cascading navigation dropdowns in a sticky header. The current dropdown path follows the documentation heading at the vertical midpoint of the viewport. Platform integrity details are attached after the guide so they appear only at the end of this tab.

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
