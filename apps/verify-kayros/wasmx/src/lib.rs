use provable_wasmx_core::{execute_json, export_provable_abi, sha3_256};
use serde::{Deserialize, Serialize};

export_provable_abi!();

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Input {
    previous_hash: String,
    data_type: String,
    data_item: String,
    timestamp_id: String,
    hash_type: String,
    expected_hash: String,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct Output {
    computed_hash: String,
    matches: bool,
    input_bytes: usize,
}

#[no_mangle]
pub unsafe extern "C" fn provable_run(pointer: u32, length: u32) -> u64 {
    execute_json(pointer, length, compute)
}

fn compute(input: Input) -> Result<Output, String> {
    if input.hash_type != "sha3_256" {
        return Err(format!(
            "Unsupported Kayros hash algorithm: {}",
            input.hash_type
        ));
    }
    let previous_hash = decode_fixed_hex::<32>(&input.previous_hash, "previous hash")?;
    let data_item = decode_fixed_hex::<32>(&input.data_item, "data item")?;
    let timestamp = decode_fixed_hex::<16>(
        &input.timestamp_id.replace('-', ""),
        "timestamp UUID",
    )?;
    let expected_hash = decode_fixed_hex::<32>(&input.expected_hash, "expected hash")?;
    let data_type = input.data_type.as_bytes();
    if data_type.is_empty() || data_type.len() > 32 {
        return Err("Kayros data type must contain 1 to 32 UTF-8 bytes".to_string());
    }

    let mut payload = Vec::with_capacity(32 + data_type.len() + 32 + 16);
    payload.extend_from_slice(&previous_hash);
    payload.extend_from_slice(data_type);
    payload.extend_from_slice(&data_item);
    payload.extend_from_slice(&timestamp);
    let digest = sha3_256(&payload);

    Ok(Output {
        computed_hash: encode_hex(&digest),
        matches: constant_time_equal(&digest, &expected_hash),
        input_bytes: payload.len(),
    })
}

fn decode_fixed_hex<const N: usize>(value: &str, label: &str) -> Result<[u8; N], String> {
    let normalized = value.strip_prefix("0x").unwrap_or(value);
    if normalized.len() != N * 2 {
        return Err(format!("Kayros {label} must be {N} bytes"));
    }
    let mut output = [0_u8; N];
    for (index, byte) in output.iter_mut().enumerate() {
        let offset = index * 2;
        *byte = u8::from_str_radix(&normalized[offset..offset + 2], 16)
            .map_err(|_| format!("Kayros {label} must be hexadecimal"))?;
    }
    Ok(output)
}

fn encode_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn constant_time_equal(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0_u8, |difference, (left, right)| difference | (left ^ right))
        == 0
}

#[cfg(test)]
mod tests {
    use super::{compute, Input, Output};

    fn live_record_input() -> Input {
        Input {
            previous_hash: "159725cc3d317ca86194d94ddae0c728378c06509de199fef76556fa42e119db"
                .to_string(),
            data_type: "provable_sdk".to_string(),
            data_item: "04b78883e395b678add9dd89da97d3e2840cd4b9253a7164253b8c9c69145425"
                .to_string(),
            timestamp_id: "7542ccba-8ff7-11f1-8000-fc7400000000".to_string(),
            hash_type: "sha3_256".to_string(),
            expected_hash: "1faece94494562e82b3ddc527798e357188b9db3abf98e555d7a6e324feaf03f"
                .to_string(),
        }
    }

    #[test]
    fn reproduces_a_real_kayros_record_hash_locally() {
        assert_eq!(
            compute(live_record_input()).expect("valid record"),
            Output {
                computed_hash:
                    "1faece94494562e82b3ddc527798e357188b9db3abf98e555d7a6e324feaf03f"
                        .to_string(),
                matches: true,
                input_bytes: 92,
            }
        );
    }

    #[test]
    fn detects_a_wrong_stored_hash() {
        let mut input = live_record_input();
        input.expected_hash = "00".repeat(32);
        let output = compute(input).expect("valid record fields");
        assert!(!output.matches);
    }
}
