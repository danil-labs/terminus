use std::{path::Path, time::Duration};
fn main() {
    let args: Vec<_> = std::env::args().collect();
    let result = (|| {
        if !(3..=4).contains(&args.len()) {
            return Err(terminus_engine_protocol::Error::new("invalid_request"));
        }
        let client = terminus_engine_client::Client::select(Path::new(&args[1]))?;
        let body = if args.len() == 4 {
            serde_json::from_slice(&std::fs::read(&args[3])?)?
        } else {
            serde_json::json!({})
        };
        client.request(&args[2], None, body, Duration::from_secs(30))
    })();
    match result {
        Ok(value) => println!("{value}"),
        Err(error) => {
            eprintln!("{}", serde_json::to_string(&error).unwrap_or_default());
            std::process::exit(1);
        }
    }
}
