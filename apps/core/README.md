# Provable Core

`apps/core/` is the mandatory shared dependency for Provable apps.

- `src/` exposes TypeScript app, local-record, and Google Drive authorization contracts; canonical hashing; immutable IndexedDB record and verified-resource storage; shared record and connected-account presentation; Kayros adapters; a bounded JSON Schema validator; and the dedicated-worker WasmX browser runner with digest, schema, byte, time, cancellation, and memory enforcement.
- `wasmx/` exposes the Rust helpers and exported ABI used by every WasmX module.
- Shared browser rendering, verified-resource loading, and local-record storage belong here; platform-specific settings/auth storage, navigation, and packaging stay under `web/` or `extension/`.

## Bundled app integrity

The browser loader accepts resources only below the platform bundle root and rejects redirects. It strictly validates release manifests, authorizes only publisher claims pinned by the current build profile, verifies the app/UI/Core digest closure, saves exact verified bytes in the SHA-256-keyed `provable-resource-cache`, reads executable bytes back, re-hashes them, and only then instantiates WasmX.

This is a packaged-artifact trust policy, not publisher signature verification. The UI says “publisher signature not configured” until trusted keys, signing, rotation, and revocation are implemented. A cache entry can never turn remotely downloaded Wasm into Chrome-store-compliant extension code.

## Local records

Core separates pre-execution `DiagnosticRecordV1` values from `ExecutionRecordV1` values. Diagnostics retain only an input digest and can never be proof-eligible. Every app WasmX invocation records its exact app manifest/module/UI/Core identities, canonical input and output, outcome, Kayros source metadata, and eligibility reasons. Browser targets keep these unsigned records in their own origin-local IndexedDB stores and revalidate their structure and digests when reading them.

An exact Kayros database match or locally matching chain hash is not yet an independently trusted-root proof. Such records are intentionally labeled `source-unanchored` and are not eligible for proof actions.

## Google Drive boundary

Core defines the narrow `drive.file` plus email scopes, validates the Google UserInfo response, presents connect/disconnect state, and exposes a token-provider interface for future archive requests. Platform adapters own the actual OAuth flow. The Chrome adapter uses `chrome.identity`; access tokens stay in Chrome's cache and are never persisted by Core. The static web adapter remains unavailable until a remote-code exception or backend flow is explicitly approved. No Drive archive upload exists yet.

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
