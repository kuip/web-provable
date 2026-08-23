# Provable

A browser application and extension for using and extending Kayros with integrity-checked WasmX apps.

## Stack

- a GitHub Pages web app
- a Chrome extension
- a Safari extension
- ability to download (for example from github) in cache and run Wasm (WasmX modules)
- https://github.com/ark-us/wasmx
- ability to verify that all run code is unchanged
- ability to save in Google Drive the proofs

## Behavior

- present Markdown with input fields in the text
- calculate other read-only input fields based on the first
- ability to fetch/request from the internet
- ability to log an entry and get a proof from Kayros (via https://github.com/kuip/provable-sdk)
- has 2 themes: dark and light and the choice is done by the system
- a click on the icon opens a side pannel in the browser. Everything happens in that pannel.
- logo from `static/image/logo.*`

## Architecture

- `apps/core/` owns reusable TypeScript services, browser UI/runtime helpers, Kayros access, SHA3-256, and the common Rust/WasmX ABI.
- `apps/prove-inclusion/` owns the platform-independent Prove Inclusion rules, workflow, Markdown UI, and WasmX computation.
- `extension/chrome/` is the thin Manifest V3 adapter for Chrome storage and side-panel behavior.
- `web/` is the thin GitHub Pages adapter for web navigation, URL input, and browser-local settings.
- `tools/` assembles and verifies the independent `dist/chrome/` and `dist/web/` artifacts.

Both browser targets load the same generated app manifests, verify the packaged UI and WasmX digests, reject imported Wasm functions, and call the same Prove Inclusion workflow. No remote executable code is used.

## Development

Requirements: Node.js 22, Rust, and the `wasm32-unknown-unknown` target.

```sh
npm install
npm run check
```

Build only the GitHub Pages site:

```sh
npm run build:web
npm run verify:web
```

Serve `dist/web/` from a local HTTP server; WebAssembly does not need to be fetched from a remote host. The static artifact never includes a Kayros API key. Users set their key in Core, where the web adapter stores it in that browser's local storage.

## GitHub Pages

Pushing `main` runs `.github/workflows/pages.yml`, rebuilds both WasmX modules from source, verifies the resulting static artifact, and deploys `dist/web/`. In the repository settings, choose **GitHub Actions** as the Pages source.

The web adapter accepts reviewed form prefills through the URL fragment and removes them from the address bar without automatically running the app:

```text
https://kuip.github.io/web-provable/#v=1&app=prove-inclusion&a=hello%20world%20hello&b=hello&n=1
```

The fragment keeps A, B, and N out of the HTTP request, but it can still appear in browser history, copied links, screenshots, and local telemetry before Provable removes it. Do not put secrets in shared URLs.

## Apps

In the dir apps/ we will have wasmX apps that extend the functionality

### Prove Inclusion

An app that:

- given:
  - a text A
  - a text B
  - an integer N (optional): defaults to 0
- provides:
  - the SHA3-256 hash of A
  - confirmation that the hash exists in Kayros `s32_hashes` with `data_type: provable_sdk`
  - the Kayros timestamp and block/position where A was notarized
  - a search for B in A, performed only after the Kayros notarization is found
  - counts C how many times B is found in A
  - returns True if N is less than C, False otherwise
  - ability to record the terms and the answer on Kayros (https://github.com/kuip/provable-sdk)
