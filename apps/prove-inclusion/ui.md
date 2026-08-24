# Prove Inclusion

Verify that **A** is notarized on Kayros, then count how many times **B** occurs in **A** with the packaged WasmX module. `N` is optional and defaults to `0`.

## Inputs

{{field:a}}

{{field:b}}

{{field:n}}

{{action:run}}

## Kayros notarization

{{field:contentHash}}

{{field:kayrosMatch}}

{{field:kayrosTimestamp}}

{{field:kayrosBlock}}

## Result

{{field:count}}

{{field:result}}

------

# Documentation & guide

Use the chapter dropdowns above to move through this guide. As you scroll, the navigation follows the section crossing the middle of the visible page.

## Overview

Prove Inclusion first establishes that the exact content of **A** was notarized by Kayros. Only after that check succeeds does the packaged WasmX application count **B** in **A** and evaluate the optional threshold **N**.

### What is verified

The Core WasmX module computes SHA3-256 from the UTF-8 bytes of **A** inside your browser. Provable looks for that digest in Kayros table `s32_hashes` with `data_type` set to `provable_sdk`.

#### A matching notarization

When Kayros returns the digest, Provable shows its timestamp and block or position. This confirms when the digest was recorded; it does not reveal who originally supplied the text unless that information exists in a separate record.

#### A missing notarization

If the digest is absent or the Kayros request fails, Provable stops. It does not run the inclusion count or show a computed result.

### What is computed

The Prove Inclusion WasmX module counts exact, case-sensitive, non-overlapping occurrences of **B** in **A**. The result is true when `N < C`, where **C** is the occurrence count and **N** defaults to zero.

## Step-by-step guide

Follow these steps in order. Your current form values remain available when you switch between the application and documentation tabs.

### 1. Configure Kayros

Open **Core** from the application selector and save a valid Kayros API key. The Chrome extension stores it in extension-local storage; the web app stores it in this browser's local storage.

#### Check the connection

Use **Latest Kayros hash** in Core to confirm the connection. A successful response shows the latest `provable_sdk` hash with its timestamp and block or position.

### 2. Enter text A

Return to **Prove Inclusion** and enter the complete text whose notarization you want to verify. Whitespace, punctuation, letter case, and line breaks affect the SHA3-256 digest.

#### Preserve exact content

Copy **A** without reformatting it. Even a one-character change produces a different digest and therefore looks for a different Kayros record.

### 3. Enter text B

Enter the exact non-empty text to count. Matching is case-sensitive and does not normalize Unicode or ignore whitespace.

#### Non-overlapping matches

Matches are consumed from left to right. For example, **B** equal to `aa` occurs twice in **A** equal to `aaaa`.

### 4. Set optional N

Leave **N** empty to use zero, or enter a non-negative integer. Provable returns true only when the final count is strictly greater than **N**.

#### Threshold examples

If **C** is two, **N** equal to one returns true, while **N** equal to two returns false.

### 5. Verify and count

Select **Verify A and count B**. Provable hashes **A**, checks Kayros, displays the matching record, executes the verified WasmX module, and cross-checks its output against the shared reference implementation.

## Matching rules

These rules make results deterministic across the Chrome extension and the GitHub Pages app.

### Exact comparison

Matching is case-sensitive. `Kayros` and `kayros` are different values, and no locale-specific conversion is applied.

#### Whitespace and newlines

Spaces, tabs, and line breaks are ordinary content. They must appear in **B** exactly as they appear in **A** to count as a match.

### Count behavior

The search advances past each complete match before looking for the next one. Overlapping occurrences are not counted.

#### Empty B

An empty **B** is rejected because it would not define a finite, useful occurrence count.

### Threshold behavior

The comparison is strictly `N < C`, not `N <= C`. An omitted **N** is treated as zero.

## Privacy and integrity

Provable packages the application UI, Core WasmX module, and Prove Inclusion WasmX module with the browser artifact.

### Data sent to Kayros

The current notarization check sends the SHA3-256 digest of **A** and the configured API key to Kayros. It does not send **A**, **B**, or **N** as part of this lookup.

#### Shared URLs

The web app can prefill **A**, **B**, and **N** from a URL fragment. Review imported values before running and avoid sharing sensitive content in URLs or screenshots.

### Packaged code verification

Before rendering or execution, Core checks the SHA-256 digest of the UI Markdown and both local WasmX modules against their packaged release manifests.

#### Execution boundary

Both WasmX modules must have zero imports and the expected ABI exports. A digest mismatch, unexpected import, missing export, or output disagreement stops the operation.
