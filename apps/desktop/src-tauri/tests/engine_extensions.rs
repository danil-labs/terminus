//! Las extensiones del motor (`engine-protocol` `EXTENSIONS`) no redefinen órdenes:
//! `full_manifest` salta un nombre repetido sin avisar, así que aquí falla.
use std::collections::HashSet;

use terminus_engine_protocol::{EXTENSIONS, MANIFEST};

#[test]
fn extensions_do_not_redefine_commands() {
    let base: serde_json::Value = serde_json::from_str(MANIFEST).unwrap();
    let mut seen: HashSet<String> = base["commands"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|c| c["name"].as_str().map(str::to_owned))
        .collect();
    for raw in EXTENSIONS {
        let ext: serde_json::Value = serde_json::from_str(raw).expect("extension manifest");
        for command in ext["commands"].as_array().expect("extension commands") {
            let name = command["name"].as_str().expect("command name").to_owned();
            assert!(
                seen.insert(name.clone()),
                "la orden {name} ya existe en la base o en otra extensión"
            );
        }
    }
}
