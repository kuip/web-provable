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
- render every app Markdown file as tabs separated by a line of six or more hyphens; an open-book tab contains the sticky, scroll-aware documentation guide and ends with code integrity details
- calculate other read-only input fields based on the first
- ability to fetch/request from the internet
- ability to log an entry and get a proof from Kayros (via https://github.com/kuip/provable-sdk)
- has 2 themes: dark and light and the choice is done by the system
- a click on the icon opens a side pannel in the browser. Everything happens in that pannel.
- logo from `static/image/logo.*`

## Architecture

- `apps/core/` owns reusable TypeScript services, browser UI/runtime helpers, Kayros access, Google Drive authorization contracts/account presentation, SHA3-256, and the common Rust/WasmX ABI.
- `apps/prove-inclusion/` owns the platform-independent Prove Inclusion rules, workflow, Markdown UI, and WasmX computation.
- `apps/verify-kayros/` owns record lookup and local recomputation of Kayros chained record hashes.
- `extension/chrome/` is the thin Manifest V3 adapter for Chrome storage, packaged Google identity, and side-panel behavior.
- `web/` is the thin GitHub Pages adapter for URL input and browser-local settings; its visible shell and application presentation mirror the Chrome extension unless a platform difference is required.
- `tools/` assembles and verifies the independent `dist/chrome/` and `dist/web/` artifacts.

Both browser targets load the same generated app manifests only from their artifact root, reject redirects and unknown manifest fields, authorize the first-party publisher claim through a pinned bundle policy, verify the complete app/UI/Core digest closure, and save the exact bytes into a content-addressed IndexedDB cache before execution. Executable bytes are read back and re-hashed before WasmX instantiation. No remote executable code is used, and caching is not treated as a way around Chrome's remote-code policy. Publisher signature verification remains visibly unconfigured until its key and rotation policy is frozen. Core also gives both targets the same local record contracts, immutable IndexedDB store, and status/history presentation.

Explicit valid attempts rejected before WasmX create digest-only diagnostics. Every app WasmX invocation creates an unsigned local execution record containing canonical inputs and outputs. Current Kayros database and chain-hash checks are not anchored to an independently trusted root, so the UI correctly labels their execution records proof-ineligible; nothing is submitted to Kayros or Drive yet. Chrome can establish an optional Drive session and show its verified account email, but proof upload is not exposed until proof eligibility and archive contracts are complete.

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

## Google Drive sign-in

Chrome uses the packaged [`chrome.identity`](https://developer.chrome.com/docs/extensions/reference/api/identity) API; it does not load Google sign-in JavaScript at runtime. The authorization requests only the recommended [`drive.file`](https://developers.google.com/workspace/drive/api/guides/api-specific-auth) scope and the email scope needed to identify the connected account. `drive.file` limits Provable to files it creates or files the user explicitly selects. Chrome owns the short-lived access-token cache; Provable does not put bearer tokens in local or extension storage.

To configure a Chrome build:

1. Enable the Google Drive API and configure the OAuth consent screen in a Google Cloud project.
2. Create a Chrome Extension OAuth client for the extension ID shown on `chrome://extensions` (use the final Chrome Web Store extension ID for release builds).
3. Copy `.env.example` to the ignored `.env` file and set the public client ID:

   ```dotenv
   GOOGLE_DRIVE_CHROME_CLIENT_ID=123456-example.apps.googleusercontent.com
   ```

4. Run `npm run build:chrome`, reload `dist/chrome/`, select Core, and choose **Connect Google Drive**. Core restores an already-authorized Chrome session without prompting, or opens authorization only after that button is selected. It then shows the verified email address. **Disconnect** clears this extension's cached Google authorization.

An OAuth client ID is public configuration, not a secret; no client secret belongs in this repository or extension artifact. If the client ID is absent, the connection button explains that the build is not configured.

The static GitHub Pages build currently shows the same Core account panel but keeps connection unavailable. Google's supported browser-only flow requires its remotely hosted Google Identity Services script, while Provable's current integrity policy allows only packaged executable code. Enabling web sign-in therefore requires an explicit decision between that web-only policy exception and a small OAuth backend; the build does not silently weaken the policy.

## GitHub Pages

Pushing `main` runs `.github/workflows/pages.yml`, rebuilds all WasmX modules from source, verifies the resulting static artifact, and deploys `dist/web/`. In the repository settings, choose **GitHub Actions** as the Pages source.

The web adapter accepts reviewed form prefills through the URL fragment and removes them from the address bar without automatically running the app:

```text
https://kuip.github.io/web-provable/#v=1&app=prove-inclusion&a=hello%20world%20hello&b=hello&n=1
```

Verify Kayros can be prefilled with one record hash or data item:

```text
https://kuip.github.io/web-provable/#v=1&app=verify-kayros&recordHash=1faece94494562e82b3ddc527798e357188b9db3abf98e555d7a6e324feaf03f
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

### Verify Kayros

An app that:

- searches `s32_hashes` with `data_type: provable_sdk` by an exact Kayros record hash or data item
- refuses to choose silently when one data item matches multiple records
- rebuilds the record input locally as `previous_hash || data_type || data_item || timestamp_uuid`
- runs FIPS SHA3-256 in packaged WasmX and cross-checks it with the packaged Core implementation
- reports whether the locally calculated hash exactly matches the `hash_item` stored by Kayros

This verifies the record-hash calculation. It does not yet prove Merkle inclusion against an independently trusted root.
