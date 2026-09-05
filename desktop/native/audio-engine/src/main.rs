#![forbid(unsafe_code)]

use std::env;
use std::process::ExitCode;

const PROTOCOL_VERSION: u16 = 1;

fn main() -> ExitCode {
    match env::args().nth(1).as_deref() {
        Some("--healthcheck") => {
            println!(
                "{{\"protocol_version\":{PROTOCOL_VERSION},\"engine_version\":\"{}\",\"status\":\"ready\"}}",
                env!("CARGO_PKG_VERSION")
            );
            ExitCode::SUCCESS
        }
        Some("--version") => {
            println!("orion-audio-engine {}", env!("CARGO_PKG_VERSION"));
            ExitCode::SUCCESS
        }
        _ => {
            eprintln!("usage: orion-audio-engine --healthcheck | --version");
            ExitCode::from(64)
        }
    }
}
