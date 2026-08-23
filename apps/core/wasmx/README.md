# Common WasmX library

This crate implements `web-provable:app/1` for all Web Provable modules.

Modules consume JSON UTF-8 input and return a packed pointer/length to a JSON result envelope. The browser host permits no imports in ABI v1, so modules have no ambient network, storage, clock, randomness, DOM, or browser API access.

Required exports are generated with `export_web_provable_abi!()`:

- `web_provable_abi_version() -> u32`
- `web_provable_alloc(length: u32) -> u32`
- `web_provable_dealloc(pointer: u32, length: u32)`
- app-defined `web_provable_run(pointer: u32, length: u32) -> u64`

