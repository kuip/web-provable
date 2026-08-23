use provable_wasmx_core::{execute_json, export_provable_abi};
use serde::{Deserialize, Serialize};

export_provable_abi!();

#[derive(Deserialize)]
struct Input {
    a: String,
    b: String,
    n: Option<i64>,
}

#[derive(Debug, PartialEq, Serialize)]
struct Output {
    count: u64,
    result: bool,
}

#[no_mangle]
pub unsafe extern "C" fn provable_run(pointer: u32, length: u32) -> u64 {
    execute_json(pointer, length, compute)
}

fn compute(input: Input) -> Result<Output, String> {
    if input.b.is_empty() {
        return Err("Text B must not be empty".to_string());
    }
    let n = input.n.unwrap_or(0);
    if n < 0 {
        return Err("N must be a non-negative integer".to_string());
    }
    let count = input.a.match_indices(&input.b).count() as u64;
    Ok(Output {
        count,
        result: (n as u64) < count,
    })
}

#[cfg(test)]
mod tests {
    use super::{compute, Input, Output};

    #[test]
    fn counts_non_overlapping_matches() {
        let output = compute(Input {
            a: "aaaa".to_string(),
            b: "aa".to_string(),
            n: Some(1),
        })
        .expect("valid input");
        assert_eq!(
            output,
            Output {
                count: 2,
                result: true,
            }
        );
    }

    #[test]
    fn defaults_optional_threshold_to_zero() {
        let output = compute(Input {
            a: "abc".to_string(),
            b: "b".to_string(),
            n: None,
        })
        .expect("valid input");
        assert_eq!(
            output,
            Output {
                count: 1,
                result: true,
            }
        );
    }
}
