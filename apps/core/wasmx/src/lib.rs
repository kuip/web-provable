use serde::{de::DeserializeOwned, Serialize};
use sha3::{Digest, Sha3_256};

pub const ABI_VERSION: u32 = 1;

#[derive(Serialize)]
struct Success<T: Serialize> {
    ok: bool,
    value: T,
}

#[derive(Serialize)]
struct Failure {
    ok: bool,
    error: String,
}

pub fn allocate(length: u32) -> u32 {
    if length == 0 {
        return 0;
    }
    let mut bytes = vec![0_u8; length as usize].into_boxed_slice();
    let pointer = bytes.as_mut_ptr();
    std::mem::forget(bytes);
    pointer as u32
}

/// # Safety
///
/// `pointer` and `length` must identify an allocation returned by this crate.
pub unsafe fn deallocate(pointer: u32, length: u32) {
    if pointer == 0 || length == 0 {
        return;
    }
    let slice = std::ptr::slice_from_raw_parts_mut(pointer as *mut u8, length as usize);
    drop(Box::from_raw(slice));
}

/// Executes a typed app function using the shared JSON wire envelope.
///
/// # Safety
///
/// The caller must provide a readable input range inside this module's linear memory.
pub unsafe fn execute_json<Input, Output, Run>(pointer: u32, length: u32, run: Run) -> u64
where
    Input: DeserializeOwned,
    Output: Serialize,
    Run: FnOnce(Input) -> Result<Output, String>,
{
    let input = if length == 0 {
        &[]
    } else {
        std::slice::from_raw_parts(pointer as *const u8, length as usize)
    };

    let output = match serde_json::from_slice::<Input>(input) {
        Ok(value) => match run(value) {
            Ok(value) => serde_json::to_vec(&Success { ok: true, value }),
            Err(error) => serde_json::to_vec(&Failure { ok: false, error }),
        },
        Err(error) => serde_json::to_vec(&Failure {
            ok: false,
            error: format!("Invalid WasmX input: {error}"),
        }),
    }
    .unwrap_or_else(|_| br#"{"ok":false,"error":"Unable to encode WasmX result"}"#.to_vec());

    leak_output(output)
}

pub fn leak_output(output: Vec<u8>) -> u64 {
    let length = output.len() as u32;
    if length == 0 {
        return 0;
    }
    let mut output = output.into_boxed_slice();
    let pointer = output.as_mut_ptr() as u32;
    std::mem::forget(output);
    ((pointer as u64) << 32) | length as u64
}

pub fn sha3_256(input: &[u8]) -> [u8; 32] {
    Sha3_256::digest(input).into()
}

#[macro_export]
macro_rules! export_provable_abi {
    () => {
        #[no_mangle]
        pub extern "C" fn provable_abi_version() -> u32 {
            $crate::ABI_VERSION
        }

        #[no_mangle]
        pub extern "C" fn provable_alloc(length: u32) -> u32 {
            $crate::allocate(length)
        }

        #[no_mangle]
        pub unsafe extern "C" fn provable_dealloc(pointer: u32, length: u32) {
            $crate::deallocate(pointer, length)
        }
    };
}

#[cfg(feature = "module")]
mod module_exports {
    crate::export_provable_abi!();

    #[no_mangle]
    pub unsafe extern "C" fn provable_sha3_256(pointer: u32, length: u32) -> u64 {
        let input = if length == 0 {
            &[]
        } else {
            std::slice::from_raw_parts(pointer as *const u8, length as usize)
        };
        crate::leak_output(crate::sha3_256(input).to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::sha3_256;

    #[test]
    fn matches_fips_sha3_256_vectors() {
        assert_eq!(
            to_hex(&sha3_256(b"")),
            "a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a"
        );
        assert_eq!(
            to_hex(&sha3_256(b"abc")),
            "3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532"
        );
    }

    fn to_hex(bytes: &[u8]) -> String {
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }
}
