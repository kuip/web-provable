use provable_wasmx_core::{export_provable_abi, leak_output};

export_provable_abi!();

#[no_mangle]
pub unsafe extern "C" fn provable_run(_pointer: u32, _length: u32) -> u64 {
    loop {
        std::hint::spin_loop();
    }

    #[allow(unreachable_code)]
    leak_output(Vec::new())
}
