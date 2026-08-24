# Verify Kayros

Search `s32_hashes` for a `provable_sdk` record, then recompute its chained record hash locally with packaged WasmX and Core SHA3-256.

## Find a record

Enter exactly one value. A **Kayros record hash** identifies one record; a **data item** may match more than one record.

{{field:recordHash}}

{{field:dataItem}}

{{action:run}}

## Kayros record

{{field:lookupStatus}}

{{field:recordDataType}}

{{field:recordDataItem}}

{{field:previousHash}}

{{field:hashType}}

{{field:kayrosTimestamp}}

{{field:kayrosBlock}}

## Local verification

{{field:storedHash}}

{{field:localHash}}

{{field:hashMatches}}

------

# Documentation & guide

## Overview

Verify Kayros retrieves a record from table `s32_hashes` for `data_type: provable_sdk`. It independently rebuilds the bytes Kayros hashes and runs FIPS SHA3-256 inside the packaged Verify Kayros WasmX module.

### What the comparison proves

A true result means the retrieved record fields produce exactly the `hash_item` stored by Kayros. Any change to the previous hash, data type, data item, timestamp UUID, or stored hash makes the comparison fail.

### What it does not prove

This check verifies the record-hash calculation. By itself, it does not establish Merkle inclusion, finality, or an independently trusted Kayros root. Those require a proof and trust anchor in a later verification layer.

## Step-by-step guide

### 1. Configure Kayros

Open **Core**, save your Kayros API key, and confirm that **Latest Kayros hash** loads.

### 2. Choose one lookup

Paste either the record's `hash_item` into **Kayros record hash**, or its `data_item` into **Data item**. Values may be 64 hexadecimal characters, optionally prefixed by `0x`, or a 32-byte Base64 value.

#### Prefer the record hash

A record hash is unambiguous. A data item can occur more than once; when it does, Provable asks you to use a record hash instead of selecting one silently.

### 3. Search and verify

Select **Search and verify locally**. Provable fetches the row, validates the returned lookup fields, and passes the normalized record into the packaged WasmX module.

## Local hash construction

The local input is the exact byte concatenation below, without JSON, separators, or a network recomputation call.

### Ordered fields

`previous hash (32 bytes) || data type (UTF-8) || data item (32 bytes) || timestamp UUID (16 bytes)`

#### First record

If a record has no previous hash, the first 32 bytes are zero. The current Kayros record algorithm must be `sha3_256`; unsupported algorithms are rejected rather than guessed.

## Privacy and integrity

The lookup sends the selected hash, fixed data type, and configured API key to Kayros. Local recomputation runs only from packaged code after the record is returned.

### Packaged code verification

Provable verifies the SHA-256 digests of this UI, the Verify Kayros WasmX module, and Core WasmX before execution. Both WasmX modules must have zero imports and the expected ABI exports.
