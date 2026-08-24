# ADR 0003: Separate local diagnostics from WasmX execution records

- Status: Accepted
- Date: 2026-08-24

## Context

Provable needs an audit trail for explicit attempts without implying that every attempt executed code or produced a proof. A rejected Kayros pre-check, a failed WasmX invocation, and a successful computation have different security meanings. Chrome and the GitHub Pages app also have separate origins and storage, so the same record behavior must be supplied by Core rather than by platform-specific formats.

## Decision

Core defines two closed version-1 JSON contracts with one canonical JSON serialization:

- `DiagnosticRecordV1` is emitted only for an explicit, syntactically valid attempt stopped before the app WasmX invocation. It stores only the canonical input SHA-256, the failed stage and structured error. It is local, unsigned, and permanently proof-ineligible.
- `ExecutionRecordV1` is emitted around every attempted app WasmX invocation and records success, failure, or cancellation. It stores canonical inputs and any validated output, host timestamps, the declared capability use, exact app/build identities, Kayros source metadata, eligibility reasons, and a SHA-256 over the complete pre-notarization record.

Both browser targets persist immutable records in origin-local IndexedDB through the shared Core store and UI controller. Reads revalidate the closed structure, the outer record digest, and embedded canonical input/output digests. Ordinary incomplete or syntactically invalid form input creates no record.

The current Kayros database lookup and local chain-hash check do not establish an independently trusted root. Their source metadata therefore has `trustAnchored: false`; successful records are shown as “proof ineligible” with the `source-unanchored` reason. No current UI path submits these records to Kayros or Drive. Only a successful, schema-valid execution with a locally verified and trust-anchored source can become eligible for a future proof action.

## Consequences

- A diagnostic can never be confused with an execution or proof.
- Failed and cancelled executions remain auditable but cannot enter a notarizing or proved state.
- Diagnostic records avoid retaining plaintext inputs; local execution records intentionally retain canonical inputs and outputs, which the UI discloses.
- The app publisher is recorded as an identity string, not yet treated as a verified signature or trust decision.
- Network request/response transcript digests, a signed publisher chain, trusted-root Kayros proofs, notarization receipts, export, and Drive archival remain later schema/state extensions.
