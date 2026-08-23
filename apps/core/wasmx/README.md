# Common WasmX library

This crate implements `provable:app/1` for all Provable modules and provides the shared FIPS SHA3-256 implementation.

Modules consume JSON UTF-8 input and return a packed pointer/length to a JSON result envelope. The browser host permits no imports in ABI v1, so modules have no ambient network, storage, clock, randomness, DOM, or browser API access.

Required exports are generated with `export_provable_abi!()`:

- `provable_abi_version() -> u32`
- `provable_alloc(length: u32) -> u32`
- `provable_dealloc(pointer: u32, length: u32)`
- app-defined `provable_run(pointer: u32, length: u32) -> u64`

The packaged core module additionally exports `provable_sha3_256(pointer, length) -> u64`.
