# Web Provable implementation plan

**Status:** Development started. The repository uses `apps/core/` as the shared TypeScript and WasmX foundation, and the MVP store artifacts bundle every executable module from the same GitHub revision.

### Implemented baseline

- npm and Cargo workspaces with pinned JavaScript and Rust lockfiles.
- `apps/core/` shared contracts, canonical SHA-256 helpers, Kayros SDK adapter, browser WasmX host, and Rust ABI crate.
- Prove Inclusion reference implementation and Rust/WasmX module consuming both core libraries.
- Chrome Manifest V3 side-panel slice that hashes the locally packaged module before instantiation.
- Cross-language tests plus an assembled-artifact check for CSP, local resources, digests, ABI exports, and a zero-import WasmX module.

The current panel computes an integrity-checked preview. Kayros source-proof verification, execution-record notarization, worker termination, full resource limits, Markdown form rendering, Drive archival, and Safari remain milestone work below.

## 1. Goal

Build a desktop browser extension that hosts verifiable WasmX applications in a browser panel. The first application, **Prove Inclusion**, verifies that a text was notarized by Kayros, counts occurrences of one text inside another, evaluates a threshold, and can notarize and archive the resulting execution record.

The implementation should maximize shared code between Chrome and Safari while isolating browser-specific UI, identity, storage, and packaging behavior behind adapters.

### Proposed MVP boundary

- Desktop Chrome with a native extension side panel.
- macOS Safari with a phase-zero decision on the closest acceptable panel experience.
- One first-party app: Prove Inclusion.
- One core app/package under `apps/core/` containing the common contracts, integrity helpers, Kayros integration, runtime interfaces, and reusable WasmX library used by every other app.
- Signed or pinned WasmX app packages, a local content-addressed cache, and an execution history.
- Kayros proof verification and record creation against one configured network/environment.
- Optional proof backup to a user-selected Google Drive location.
- System-selected light and dark themes; no manual theme setting in the MVP.

### Deferred until after the MVP

- iPhone and iPad support.
- A public third-party app marketplace, payments, ratings, or automatic publisher onboarding.
- Cross-device synchronization of extension settings and cached executable modules.
- Collaborative proof sharing or editing.
- Arbitrary page scraping or automatic access to the active tab.

## 2. Requirements and acceptance map

| ID | README requirement | MVP acceptance condition |
| --- | --- | --- |
| EXT-01 | Chrome extension | A Manifest V3 build installs cleanly and clicking its action opens the Chrome side panel. |
| EXT-02 | Safari extension | A signed development build installs on macOS Safari and opens the approved Safari panel equivalent from its toolbar action. |
| APP-01 | Apps under `apps/` | `apps/core/` provides the shared TypeScript and WasmX libraries; every independently testable app under `apps/<app-id>/` declares and uses its compatible core version. |
| WASM-01 | Download, cache, and run WasmX apps | An allowed app source resolves to immutable bytes, verifies successfully, is cached by digest, and executes through the versioned host ABI. |
| INT-01 | Verify that all executed code is unchanged | Every execution records the app manifest and module digests; a digest/signature mismatch blocks execution before instantiation. |
| UI-01 | Markdown with fields | Sanitized Markdown renders declared editable inputs and read-only outputs without allowing raw script execution. |
| UI-02 | Derived fields | Valid input changes recompute outputs predictably; invalid or incomplete inputs show field-level errors and never create a record. |
| NET-01 | Internet requests | An app can request only declared origins through a permission broker, with explicit user consent and recorded request/response digests. |
| KAY-01 | Log an entry and get a proof | A canonical execution record can be submitted to Kayros, and the returned proof is verified before being shown as valid. |
| DRV-01 | Save proofs to Google Drive | An authenticated user can save, list, retrieve, and byte-compare a proof archive in Drive. |
| THEME-01 | System light/dark theme | The complete panel follows `prefers-color-scheme`, including form controls, Markdown, statuses, and errors. |
| PI-01 | Prove Inclusion | The app verifies the supplied proof for A, computes C, evaluates `N < C`, and can record the inputs, result, module identity, and source-proof reference. |

## 3. Phase-zero decisions and feasibility gates

These are release blockers, not implementation details to discover late.

### 3.1 Distribution model for Wasm

**MVP decision: repository-bundled executables.** The whole project is a GitHub monorepo. CI builds each WasmX app from the checked-out source, verifies or generates its digest, and places the exact `.wasm` bytes and release manifest inside the Chrome and Safari extension artifacts before store submission. Updating executable app code therefore creates a new extension release tied to a Git commit and tag.

Saving a module after installation in IndexedDB or another browser cache improves integrity checking and offline use, but does not turn remotely downloaded code into an extension-package resource. Runtime-downloaded modules remain a later profile and may execute only through a policy-approved isolated sandbox or native runtime.

Keep module resolution and execution behind interfaces so the bundled profile and a future dynamic sandbox profile share the app model, verification pipeline, UI, and execution records. Arbitrary URLs are never enabled in store artifacts by accident.

The release provenance chain is:

```text
Git commit -> app source -> Wasm bytes/digest -> extension artifact/digest
           -> executed module digest -> Kayros execution record
```

**Gate resolved for MVP:** bundle executables. Record the decision in `docs/adr/0001-distribution.md`; revisit dynamic installation only after the bundled vertical slice ships.

### 3.2 WasmX browser compatibility and ABI

The referenced WasmX project is a modular blockchain engine and does not, by itself, specify the browser app-package or host ABI required by this README. Build a disposable proof of concept that answers:

- Which WasmX artifact actually runs in a browser or companion process?
- Is it a plain WebAssembly module, a contract executed by an embedded WasmX VM, or another package type?
- Which imports, memory model, serialization format, and entrypoints are required?
- Can it be interrupted, memory-bounded, and run without ambient network, DOM, clock, randomness, or storage access?
- Which licenses and notices must be included in the extension and app packages?

**Gate:** run a fixture module through a versioned `web-provable:app/1` ABI, return schema-validated output, terminate a runaway fixture, and write `docs/adr/0002-wasmx-runtime.md`.

### 3.3 Safari panel behavior

Chrome provides an extension side-panel API, while Safari Web Extensions document action popups, extension pages, and communication with a containing app rather than a portable equivalent of `chrome.sidePanel`. Evaluate these Safari options with a small UI prototype:

- A page-injected, Shadow DOM side drawer opened by the action. This most closely resembles the requested panel but needs site access and cannot work on privileged/internal pages.
- A persistent window supplied by the containing macOS app. This avoids page injection but is adjacent to Safari rather than inside its browser chrome.
- A toolbar popup or dedicated extension page. This has the lowest complexity but changes the stated product behavior.

**Gate:** choose one behavior, minimum Safari/macOS version, and fallback for pages where it cannot open in `docs/adr/0003-safari-panel.md`. The choice must be accepted as satisfying EXT-02 before building the full Safari adapter.

### 3.4 Kayros contract

Use “Kayros” consistently for the Provable product. Bundle the pinned [`@kuip/provable-sdk`](https://github.com/kuip/provable-sdk/tree/main/provable-sdk-js) and [`@kuip/provable-proof`](https://github.com/kuip/provable-sdk/tree/main/provable-proof-js) packages into the extension at build time. The shared adapter belongs in `apps/core/`; individual apps never manage Kayros transport or credentials themselves. Obtain or define:

- Base URLs and network/environment identifiers.
- Authentication and key-management flow.
- Submit/log request and response schemas.
- Proof format, canonical payload rules, verification algorithm, trust roots, expiry/revocation behavior, and error taxonomy.
- Whether plaintext terms or only a digest are submitted.
- A test environment and deterministic fixtures for offline verification.

Model this as `KayrosClient` and `KayrosVerifier` interfaces so the rest of the extension does not depend on transport details.

**Gate:** verify a known proof, reject a tampered proof, submit one test record, and capture the contract in `docs/adr/0004-kayros.md`.

### 3.5 Product semantics to freeze

Confirm these before creating permanent proof fixtures:

- Whether Google Drive archives should be visible to the user or kept in the hidden app-data folder. Prefer a visible `Web Provable/Proofs` folder for durable evidence and use the narrowest scope that supports it.
- Whether a proof archive contains plaintext inputs, digests only, or a user-selectable redaction policy.
- Which publisher keys are trusted and how key rotation/revocation works.
- Whether apps are installed from a curated registry, an entered URL, a local file, or all three.
- The exact Prove Inclusion matching rules. Proposed MVP rules are in section 7.

## 4. Proposed architecture

```text
Chrome side panel / approved Safari panel
                    |
             Shared application UI
                    |
           Execution orchestrator
          /         |          \
 App resolver   Runtime host   Proof repository
 verify/cache   + ABI worker    local + Drive
                    |
             Capability broker
             /              \
      permissioned fetch   Kayros adapter
```

### 4.1 Shared layers

- **Application UI:** navigation, Markdown rendering, form state, run status, provenance details, proof history, Drive connection, and accessible error handling.
- **Core app:** shared TypeScript contracts and services plus the common Rust/WasmX ABI crate. All other apps depend on core rather than copying host, hashing, serialization, or Kayros logic.
- **Execution orchestrator:** validates inputs, resolves an exact app version, obtains grants, invokes the runtime, validates outputs, constructs a canonical execution record, and coordinates notarization/backup.
- **App resolver:** validates app manifests, verifies signatures and digests, maintains a content-addressed cache, and handles offline resolution.
- **Runtime host:** runs one module per isolated worker or companion session and implements only the versioned WasmX ABI.
- **Capability broker:** owns fetch, Kayros, clock, randomness, and any future external capability. Modules receive no ambient browser privileges.
- **Proof repository:** keeps local records and synchronizes explicitly selected archives to Google Drive.
- **Platform adapter:** wraps action/panel behavior, optional host permissions, identity, storage, messaging, and browser feature detection.

### 4.2 Browser contexts

- Keep the panel focused on presentation and short-lived orchestration.
- Use the Manifest V3 service worker for browser events, privileged fetches, and resumable job coordination; never assume it stays alive.
- Use IndexedDB for module bytes, execution records, and retry queues. Use extension local storage only for small preferences and grants.
- Run browser-hosted modules in dedicated Web Workers so computation cannot block the panel and can be terminated on timeout.
- Keep Safari native messaging optional behind the same executor/identity interfaces.

### 4.3 Proposed repository layout

```text
apps/
  core/
    app.json
    package.json
    src/                # shared TypeScript contracts/services
    tests/
    wasmx/              # shared Rust/WasmX ABI crate
  prove-inclusion/
    app.config.json
    package.json
    ui.md
    src/
    fixtures/
    tests/
    wasmx/              # app module using apps/core/wasmx
extension/
  shared/             # panel UI and background handlers
  chrome/             # MV3 manifest and Chrome adapter
  safari/             # Safari resources, adapter, containing app project
tests/
  e2e/
  security/
tools/                # package, sign, hash, and reproducibility tooling
docs/
  adr/
.github/
  workflows/          # reproducible checks and extension artifacts
```

Use npm workspaces and TypeScript for the shared extension code, Rust targeting `wasm32-unknown-unknown` for the initial WasmX ABI and apps, JSON Schema-compatible external contracts, and a workspace build that emits separate Chrome-store, future dynamic-development, and Safari artifacts. Lock JavaScript and Rust dependencies. `apps/core/` is the only place for reusable application libraries; browser-specific adapters remain under `extension/`.

### 4.4 GitHub build and release flow

1. Check out an immutable revision with submodules/LFS objects fully resolved if they are ever introduced.
2. Build and test `apps/core/` before dependent apps.
3. Compile each app's WasmX module from source and inspect its imports/exports.
4. Compute the module and UI SHA-256 values and generate the release `app.json` without modifying the source manifest.
5. Bundle all TypeScript dependencies, including the Kayros SDK, into local extension assets; no CDN imports survive the build.
6. Assemble Chrome and Safari artifacts containing the exact modules, manifests, UI, icons, and runtime.
7. Run tamper, ABI, and end-to-end smoke tests against the assembled artifacts.
8. Publish checksums, SBOM/provenance attestations, and extension artifacts against a protected Git tag. Upload those same bytes to the stores.

## 5. App and execution contracts

### 5.1 App package

An app package contains:

- `app.json`: schema version, stable app ID, semantic version, publisher identity, ABI version, entrypoint, module digest, UI digest, declared inputs/outputs, requested capabilities, resource limits, and compatibility bounds.
- A compatible core version. Both the TypeScript workspace dependency and Rust path/crate dependency must resolve to that version during the build.
- `ui.md`: Markdown content containing field placeholders such as `{{field:A}}`; all type, editability, default, and validation metadata lives in `app.json`.
- A WasmX module and optional inert assets.
- A publisher signature over the canonical manifest. The manifest commits to every executable and UI resource by digest.

Reject unknown required manifest fields, duplicate field IDs, mutable/unpinned production URLs, unsupported ABI versions, undeclared imports, signature failures, and digest failures.

### 5.2 Resolution and integrity pipeline

1. Resolve a specific app ID and version to an immutable manifest.
2. Parse with size/depth limits and validate against the bundled schema.
3. Verify the publisher signature against the local trust policy.
4. Download or read each resource and compute SHA-256 over the exact bytes.
5. Compare every digest before writing to a temporary cache entry.
6. Promote verified bytes to a cache key derived from their digest.
7. Re-hash executable bytes immediately before instantiation.
8. Validate module imports/exports and enforce the declared ABI and limits.
9. Record the manifest, module, UI, runtime, and verifier digests in every execution record.

Store builds perform the same checks against bundled modules. Extension-package signing remains a platform trust layer; the internal digest graph makes the exact app/runtime closure visible in exported records.

### 5.3 Execution and capability model

- Pass canonical UTF-8 input bytes into the runtime and accept only size-limited, schema-valid output.
- Deny DOM, tabs, cookies, extension storage, network, clock, and randomness unless represented by a declared host call.
- Require per-app, per-version grants for network origins. Use optional host permissions where possible.
- Send no credentials or cookies by default. Redirects to a new origin require a matching grant.
- Enforce module size, memory, response size, call count, wall-clock timeout, and cancellation limits. Terminate the worker/process on violations.
- Treat network responses, time, and randomness as explicit execution inputs and commit their exact bytes or values to the record. A response digest proves which bytes were used; it does not independently prove that the remote origin authored those bytes.
- Apply a strict extension CSP, sanitize Markdown, disallow inline/evaluated script, and never inject app-provided HTML directly.

### 5.4 Canonical execution record

Define a versioned JSON model and a single canonical serialization, with fixtures shared by TypeScript and Wasm tests. It should include:

- Unique execution ID and record schema version.
- App ID/version, publisher, manifest/module/UI digests, ABI version, and runtime build digest.
- Canonical inputs and validated outputs.
- Capability grants actually used.
- External request URL/method, selected request headers, request body digest, response status/headers, and response body digest; include raw bodies only under the archive privacy policy.
- Source-proof digest and local verification result where applicable.
- Start/end timestamps supplied by the host and failure/cancellation details.
- Digest of the complete pre-notarization record.
- Kayros environment, returned receipt/proof, verifier version/digest, and verification status.

Never label a record “proved” merely because upload succeeded. Only a locally verified Kayros proof can move it to that state.

### 5.5 Drive archive

- Make Drive connection optional and user initiated.
- Default to one immutable JSON archive per execution under `Web Provable/Proofs/<app-id>/<year>/<month>/` if the visible-folder decision is approved.
- Name files with the execution ID and record digest, and include the archive schema version and content digest inside the file.
- Upload with retry-safe identifiers so retries do not create silent duplicates.
- After upload, download at least during integration tests and verify byte equality/digest.
- Keep a local `pending`, `uploaded`, or `failed` state and allow manual retry/export.
- Never overwrite an archive with different bytes; create a conflict entry and alert the user.

## 6. User experience

### 6.1 Main panel states

1. **Apps:** installed/available apps with version, publisher, verification status, and offline availability.
2. **App view:** sanitized Markdown, inputs, derived read-only fields, run/record action, and inline validation.
3. **Execution details:** exact code identities, capability inputs, source-proof result, Kayros status, and Drive status.
4. **History:** searchable local records with verify, retry, export, and save-to-Drive actions.
5. **Settings:** Kayros environment, trusted publishers, Drive connection, cache management, privacy defaults, and diagnostic export.

### 6.2 UI rules

- Follow the system theme live with `prefers-color-scheme` and expose semantic design tokens rather than app-controlled colors.
- Preserve app/form state when the panel closes or the service worker restarts.
- Use explicit statuses: unverified, verifying, verified, invalid, executing, notarizing, proved, upload pending, archived, and failed.
- Require a confirmation preview before the first notarization or Drive upload that may contain plaintext.
- Make all controls keyboard accessible, retain visible focus, announce async state through live regions, and meet WCAG 2.2 AA contrast/labeling targets.
- Render untrusted Markdown with raw HTML disabled and links opened safely; app packages cannot style or script the extension shell.

## 7. Prove Inclusion specification

### 7.1 Inputs and outputs

| Field | Type | Rules |
| --- | --- | --- |
| A | Multiline text | Required; size-limited. |
| proofA | Kayros proof text/file | Required; must verify as binding the canonical bytes of A before the result is recordable. |
| B | Text | Required and non-empty. |
| N | Integer | Optional, defaults to `0`; proposed MVP validation is `N >= 0`. |
| C | Read-only integer | Number of matches of B in A. |
| result | Read-only boolean | `true` exactly when `N < C`; otherwise `false`. |
| proofStatus | Read-only status | Verification result for proofA against A. |

### 7.2 Proposed deterministic matching rules

Freeze these rules in the phase-zero ADR before generating production proofs:

- Decode A and B as valid UTF-8.
- Compare exactly and case-sensitively, with no Unicode normalization or locale-specific behavior.
- Count non-overlapping occurrences from left to right.
- Reject an empty B rather than defining an infinite/ambiguous count.
- Example: A=`aaaa`, B=`aa` produces C=`2`; with N=`1`, result is `true`.

Put the counting algorithm in the WasmX module, not in UI code. Keep an independent reference implementation only for cross-check tests.

### 7.3 Record flow

1. Validate A, B, and N.
2. Canonicalize A and verify proofA locally through `KayrosVerifier`.
3. Allow a preview computation even if verification fails, but disable **Record proof** and clearly label the result unverified.
4. Execute the verified Prove Inclusion module to obtain C and result.
5. Construct an execution record that commits to A, B, N, C, result, proofA digest, proof verification metadata, and all code digests. Apply the approved plaintext/redaction policy.
6. Submit the record digest or canonical record to Kayros according to its contract.
7. Verify the returned proof locally, persist the complete archive, and optionally save it to Drive.

## 8. Implementation milestones

### Milestone 0 — Feasibility and contracts

- Complete the four ADR gates in section 3.
- Add a concise threat model covering registry compromise, publisher-key compromise, network tampering, cache mutation, malicious modules/Markdown, proof forgery, token theft, replay, and data leakage.
- Freeze v1 schemas for app manifests, ABI messages, execution records, and Drive archives.
- Create valid, invalid, tampered, oversized, and runaway fixtures.

**Exit:** all gates have working fixtures and an approved decision; no unresolved issue can invalidate the chosen runtime or distribution model.

### Milestone 1 — Workspace and extension shells

- Scaffold the npm/Cargo workspaces, `apps/core/`, Chrome MV3 extension, Safari development package, formatting, linting, type checking, unit tests, and CI.
- Implement the common TypeScript integrity/contracts/Kayros/runtime entrypoints and common Rust/WasmX ABI in `apps/core/`; require every app to consume these packages.
- Build Prove Inclusion as the first dependent WasmX module and cross-check its result against a TypeScript reference implementation.
- Generate all required extension icon sizes from `static/image/logo.*`; reconcile the README's `static/images` path typo without duplicating sources.
- Open an empty themed panel from the Chrome action.
- Prototype all candidate Safari panel behaviors with the same small UI.
- Add build-profile checks that prevent dynamic executables or permissions from entering the store artifact.

**Exit:** one command produces installable development artifacts; CI validates both manifests and the store-profile policy.

### Milestone 2 — Shared panel and Markdown forms

- Implement navigation, app view, history shell, settings, status model, system theme, and responsive narrow-panel layout.
- Parse Markdown into a sanitized AST and replace only declared field placeholders with controlled components.
- Implement JSON Schema-backed defaults, validation, editable/read-only behavior, debounced recomputation, and state restoration.
- Add accessibility and visual-regression coverage for both themes.

**Exit:** a fixture app safely renders all field types, survives panel/background restarts, and rejects malicious Markdown.

### Milestone 3 — App supply chain, cache, and runtime

- Implement manifest validation, trust store, signatures, digest graph, immutable resolver, content-addressed IndexedDB cache, and provenance UI.
- Implement the `web-provable:app/1` worker/companion protocol and a generated TypeScript/module conformance suite.
- Enforce import allowlists, input/output schemas, size/memory/time limits, cancellation, and structured errors.
- Emit an unsigned local execution record for every completed or failed run.

**Exit:** valid online/offline fixtures run; any one-byte manifest/module/UI mutation is blocked; runaway and oversized modules terminate safely.

### Milestone 4 — Prove Inclusion local vertical slice

- Implement the WasmX module and independent reference implementation.
- Add ASCII, Unicode, newline, NUL, empty-B, boundary, overlap, invalid-integer, maximum-size, and randomized differential tests.
- Render A, proofA, B, N, C, result, and proof status in `ui.md`.
- Use a fake Kayros verifier initially to exercise valid, invalid, and mismatched source proofs.

**Exit:** the app matches the frozen semantics for every fixture and cannot record when proofA does not bind A.

### Milestone 5 — Network capability broker

- Implement declared-origin grants, optional host-permission requests, privileged fetch messaging, redirect checks, byte limits, cancellation, and auditable errors.
- Record request/response digests and replay fixtures for deterministic tests.
- Add controls to review and revoke grants per app/version.

**Exit:** an allowed test request succeeds and is committed to the record; undeclared origins, redirect escapes, credentials, and excessive responses are blocked.

### Milestone 6 — Kayros integration

- Implement authentication/key handling, submit/log transport, local proof verification, test-network selection, retries, idempotency, and failure recovery.
- Replace fake Prove Inclusion proof fixtures with official deterministic fixtures.
- Build the execution-detail verification view and a portable “verify again” action.
- Submit hashes rather than plaintext by default if the Kayros contract supports data-blind notarization.

**Exit:** a test record receives a locally verified proof; tampering with the record or proof fails verification; retries never create an ambiguous duplicate.

### Milestone 7 — Google Drive archive

- Configure OAuth clients and platform-specific login flows without embedding client secrets.
- Implement the approved visible-folder or app-data storage choice, archive upload/list/download, idempotent retry queue, conflict handling, disconnect, and local export.
- Show exactly what will be uploaded and its plaintext/redaction status.

**Exit:** a notarized Prove Inclusion archive round-trips through Drive byte-for-byte; token expiry, revoked access, offline mode, duplicate retry, and conflict cases recover safely.

### Milestone 8 — Chrome/Safari parity

- Finish the approved Safari panel adapter and any containing-app/native-messaging work.
- Verify state, auth callbacks, permissions, IndexedDB/storage behavior, worker/runtime behavior, downloads, and Drive/Kayros requests on both browsers.
- Add automated Safari coverage where platform tooling permits and a short, reproducible manual checklist for the remaining browser-chrome interactions.

**Exit:** the requirements map passes on both target browsers or contains an explicitly approved, documented platform exception.

### Milestone 9 — Hardening and release

- Minimize permissions and host access, lock CSP, audit dependencies/licenses, scan built artifacts for remote-code paths, and fuzz manifests, Markdown, proof files, and ABI messages.
- Make builds reproducible and generate an SBOM, checksums, provenance/attestation, privacy policy, data-flow disclosure, and support diagnostics.
- Test upgrade/downgrade, cache/schema migration, corrupted storage, service-worker suspension, large inputs, slow/offline networks, and interrupted notarization/upload.
- Complete Chrome Web Store and Safari/App Store review checklists for the chosen profiles.

**Exit:** release candidates pass the full matrix, have no unresolved critical/high security findings, and meet the definition of done below.

## 9. Verification strategy

### Unit and property tests

- Canonical serialization and cross-language digest vectors.
- Signature verification, key rotation/revocation, and cache promotion.
- App manifest/field schema validation and Markdown placeholder parsing.
- Prove Inclusion edge cases plus property/differential tests.
- Execution/proof state machine and retry/idempotency logic.
- Drive path/naming, redaction, and conflict behavior.

### Contract and integration tests

- Every supported WasmX ABI import/export and error code.
- Kayros known-good, wrong-payload, malformed, expired/revoked, and wrong-network proofs.
- Google OAuth/Drive happy path and token, quota, conflict, and network failures.
- Browser messaging when the panel closes or service worker suspends mid-operation.
- Online first load, verified offline cache hit, cache corruption, version upgrade, and revoked publisher.

### End-to-end browser scenarios

- Action opens the required panel and state survives normal navigation/reopen.
- System theme changes while the panel is open.
- Install/run/remove/update Prove Inclusion under each permitted build profile.
- One-byte module tampering is detected before execution.
- Invalid proofA permits only an explicitly unverified preview.
- Valid source proof → computation → Kayros proof → local verification → Drive archive → restore and reverify.
- Revoked origin/Drive permission and offline recovery are understandable and non-destructive.
- Keyboard-only and screen-reader smoke tests in both themes and browsers.

### Security tests

- XSS payloads in Markdown, labels, app metadata, network data, and proof data.
- Manifest bombs, oversized resources, malformed Wasm, infinite loops, memory growth, excessive host calls, and cancellation races.
- Origin confusion, redirects, URL parsing, sensitive headers, SSRF protections where a companion exists, and accidental cookie forwarding.
- Replay/substitution across app versions, Kayros networks, source texts, records, and Drive files.
- Static inspection proving the store artifact contains no dynamic executable path or remotely hosted code.

## 10. Definition of done

- Every requirement in section 2 has a passing acceptance test or an explicitly approved platform exception.
- Chrome and Safari release artifacts are reproducible from a clean checkout and identify the same shared-core version.
- No executable resource runs unless its complete digest/signature chain and ABI validate immediately beforehand.
- Every proved result can be independently tied to canonical inputs, exact code identities, a verified source proof, and a locally verified Kayros proof.
- Drive is optional; disabling it never blocks local proof creation or export.
- No secret is committed or bundled, permissions are least-privilege, and plaintext disclosure is visible before submission/upload.
- The panel is usable with keyboard and assistive technology and is complete in both system themes.
- Corruption, offline operation, browser restarts, and partial remote failures do not silently lose or mislabel records.
- Store artifacts comply with their selected distribution policy; dynamic execution is unavailable where it is not approved.
- Installation, development, testing, packaging, trust-key rotation, Kayros setup, Drive OAuth setup, and proof verification are documented.

## 11. Reference material

- [Project README](README.md)
- [WasmX repository](https://github.com/ark-us/wasmx)
- [Kayros Provable SDK](https://github.com/kuip/provable-sdk)
- [Chrome Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [Chrome Manifest V3 remote hosted code policy](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code)
- [Apple: Creating a Safari Web Extension](https://developer.apple.com/documentation/safariservices/creating-a-safari-web-extension)
- [Apple: Create web extensions for Safari](https://developer.apple.com/videos/play/wwdc2026/216/)
- [Google Drive application-specific data](https://developers.google.com/workspace/drive/api/guides/appdata)
- [Kayros / Provable](https://provable.dev/)
