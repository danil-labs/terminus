//! Plan de servicio: solo produce artefactos; no instala ni modifica la configuración activa.
use serde_json::{json, Value};
use std::{io, path::Path};

pub const IDENTITY: &str = "ai.danil.terminus";
pub const LABEL: &str = "ai.danil.terminus.background-host";

pub fn metadata(value: &Value, contract: &str) -> io::Result<()> {
    let engine = &value["result"]["engine"];
    if engine["product"] != terminus_engine_protocol::PRODUCT
        || engine["protocol_version"] != terminus_engine_protocol::VERSION
        || engine["contract"] != contract
        || !["resident", "require_master_fd", "expected_contract"]
            .iter()
            .all(|feature| {
                engine["launch_features"]
                    .as_array()
                    .is_some_and(|features| {
                        features
                            .iter()
                            .any(|found| found.as_str() == Some(*feature))
                    })
            })
    {
        return Err(io::Error::other("background_engine_incompatible"));
    }
    Ok(())
}

pub fn profile(
    mut current: Value,
    data: &Path,
    engine: &Path,
    resources: &Path,
    sha256: &str,
) -> io::Result<Value> {
    // Valida todos los perfiles antes de conservar o combinar campos desconocidos.
    super::engine_profile::managed_in(&current, data)?;
    if current["profiles"].get("desktop").is_some_and(is_managed)
        && !same_root(&current["profiles"]["desktop"], data)
    {
        return Err(io::Error::other("background_profile_conflict"));
    }
    for existing in current["profiles"]
        .as_object()
        .ok_or(io::ErrorKind::InvalidData)?
        .values()
    {
        if same_root(existing, data) && is_managed(existing) {
            binding(existing, data, engine, resources, sha256)?;
        }
    }
    let fields = json!({
        "engine": engine,
        "sha256": sha256,
        "data_dir": data,
        "resource_dir": resources,
        "identity": IDENTITY,
        "production": true,
        "managed": true,
    });
    let desktop = current["profiles"]
        .as_object_mut()
        .ok_or(io::ErrorKind::InvalidData)?
        .entry("desktop")
        .or_insert_with(|| json!({}));
    desktop
        .as_object_mut()
        .ok_or(io::ErrorKind::InvalidData)?
        .extend(
            fields
                .as_object()
                .ok_or(io::ErrorKind::InvalidData)?
                .clone(),
        );
    if current["default"].is_null() {
        current["default"] = json!("desktop");
    }
    Ok(current)
}

pub fn configured(
    value: &Value,
    data: &Path,
    engine: &Path,
    resources: &Path,
    sha256: &str,
) -> io::Result<()> {
    if !super::engine_profile::managed_in(value, data)? {
        return Err(io::Error::other("background_profile_not_managed"));
    }
    for existing in value["profiles"]
        .as_object()
        .ok_or(io::ErrorKind::InvalidData)?
        .values()
    {
        if same_root(existing, data) && is_managed(existing) {
            binding(existing, data, engine, resources, sha256)?;
        }
    }
    Ok(())
}

pub fn ready(
    found: &terminus_engine_protocol::Endpoint,
    status: &Value,
    pid: u32,
    data: &Path,
    engine: &Path,
    contract: &str,
) -> io::Result<()> {
    if found.pid != pid
        || super::engine_profile::canonical(&found.data_directory) != data
        || super::engine_profile::canonical(&found.executable) != engine
        || found.contract != contract
        || found.runtime.is_empty()
        || status["runtime"] != found.runtime
        || status["pid"] != pid
        || status["data_directory"] != json!(data)
        || status["product"] != terminus_engine_protocol::PRODUCT
        || status["protocol_version"] != terminus_engine_protocol::VERSION
        || status["contract"] != contract
        || status["service"] != true
        || status["resident"] != true
        || status["service_build"].as_str().is_none_or(str::is_empty)
        || !status["service_features"]
            .as_array()
            .is_some_and(|features| {
                features
                    .iter()
                    .any(|feature| feature == "safe_maintenance_restart_v1")
            })
    {
        return Err(io::Error::other("background_ready_identity_mismatch"));
    }
    Ok(())
}

fn same_root(profile: &Value, data: &Path) -> bool {
    profile["data_dir"]
        .as_str()
        .is_some_and(|path| super::engine_profile::canonical(Path::new(path)) == data)
}

fn is_managed(profile: &Value) -> bool {
    matches!(
        profile.get("managed"),
        Some(Value::Bool(true) | Value::String(_))
    )
}

fn binding(
    value: &Value,
    data: &Path,
    engine: &Path,
    resources: &Path,
    sha256: &str,
) -> io::Result<()> {
    for (field, path) in [
        ("data_dir", data),
        ("engine", engine),
        ("resource_dir", resources),
    ] {
        if !value[field].as_str().is_some_and(|found| {
            Path::new(found).is_absolute()
                && super::engine_profile::canonical(Path::new(found)) == path
        }) {
            return Err(io::Error::other("background_profile_conflict"));
        }
    }
    if value["identity"] != IDENTITY
        || value["production"] != true
        || value["sha256"].as_str() != Some(sha256)
    {
        return Err(io::Error::other("background_profile_conflict"));
    }
    Ok(())
}

pub fn plist(executable: &Path) -> io::Result<String> {
    let executable = executable.to_str().ok_or(io::ErrorKind::InvalidData)?;
    if executable.chars().any(|c| c.is_control()) {
        return Err(io::ErrorKind::InvalidData.into());
    }
    let executable = executable
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;");
    Ok(format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>{LABEL}</string>
  <key>ProgramArguments</key><array><string>{executable}</string><string>--background-host</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>ExitTimeOut</key><integer>45</integer>
  <key>AbandonProcessGroup</key><false/>
  <key>LimitLoadToSessionType</key><string>Aqua</string>
  <key>ProcessType</key><string>Background</string>
  <key>Umask</key><integer>63</integer>
</dict></plist>
"#
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preflight_requires_exact_contract_and_all_strict_features() {
        let mut value = json!({"result":{"engine": {
            "product":terminus_engine_protocol::PRODUCT,"protocol_version":1,
            "contract":"expected","launch_features":["resident","require_master_fd","expected_contract"]
        }}});
        assert!(metadata(&value, "expected").is_ok());
        assert!(metadata(&value, "different").is_err());
        value["result"]["engine"]["launch_features"] = json!(["resident"]);
        assert!(metadata(&value, "expected").is_err());
        assert!(metadata(&json!({}), "expected").is_err());
    }

    #[test]
    fn preparation_preserves_other_profiles_but_rejects_authority_conflicts() {
        let tmp = tempfile::tempdir().unwrap();
        let data = dunce::canonicalize(tmp.path()).unwrap();
        let engine = data.join("seldon-runtime");
        let resources = data.join("Resources");
        let current = json!({"version":1,"default":"remote","extra":42,"profiles":{"remote":{"identity":"lab"},"desktop":{"future":"preserved"}}});
        let prepared = profile(current.clone(), &data, &engine, &resources, "sha").unwrap();
        assert_eq!(prepared["default"], "remote");
        assert_eq!(prepared["extra"], 42);
        assert_eq!(prepared["profiles"]["desktop"]["future"], "preserved");
        assert_eq!(
            prepared["profiles"]["remote"],
            current["profiles"]["remote"]
        );
        assert!(configured(&prepared, &data, &engine, &resources, "sha").is_ok());
        assert!(configured(&prepared, &data, &engine, &resources, "new").is_err());
        let mut conflict = prepared;
        conflict["profiles"]["alias"] = conflict["profiles"]["desktop"].clone();
        conflict["profiles"]["alias"]["identity"] = json!("another");
        assert!(profile(conflict, &data, &engine, &resources, "sha").is_err());
        assert!(profile(
            json!({"version":1,"profiles":{"bad":[]}}),
            &data,
            &engine,
            &resources,
            "sha"
        )
        .is_err());
        assert!(profile(
            json!({"version":1,"profiles":{"desktop":{"data_dir":data.join("other"),"managed":true}}}),
            &data, &engine, &resources, "sha"
        ).is_err());
    }

    #[test]
    fn plist_escapes_paths_and_supervises_only_failures() {
        let document = plist(Path::new(
            "/Applications/A&B's <test>.app/Contents/MacOS/terminus",
        ))
        .unwrap();
        assert!(document.contains("A&amp;B&apos;s &lt;test&gt;.app"));
        assert!(document.contains("<key>SuccessfulExit</key><false/>"));
        assert!(document.contains("<key>AbandonProcessGroup</key><false/>"));
        assert!(plist(Path::new("/Applications/a\nb")).is_err());
    }

    #[test]
    fn readiness_rejects_other_writers_and_unproven_residency() {
        let tmp = tempfile::tempdir().unwrap();
        let data = dunce::canonicalize(tmp.path()).unwrap();
        let engine = data.join("seldon-runtime");
        let endpoint = terminus_engine_protocol::Endpoint {
            version: 1,
            product: terminus_engine_protocol::PRODUCT.into(),
            runtime: "new-runtime".into(),
            pid: 42,
            executable: engine.clone(),
            address: "127.0.0.1:1234".parse().unwrap(),
            contract: "expected".into(),
            data_directory: data.clone(),
            token_file: data.join("token"),
        };
        let status = json!({"runtime":"new-runtime","pid":42,"data_directory":data,
            "product":terminus_engine_protocol::PRODUCT,"protocol_version":1,"contract":"expected",
            "service":true,"resident":true,"service_build":"build","service_features":["safe_maintenance_restart_v1"]});
        assert!(ready(&endpoint, &status, 42, &data, &engine, "expected").is_ok());
        assert!(ready(&endpoint, &status, 43, &data, &engine, "expected").is_err());
        assert!(ready(&endpoint, &status, 42, &data, &engine, "different").is_err());
        for (field, wrong) in [
            ("runtime", json!("stale")),
            ("pid", json!(7)),
            ("resident", Value::Null),
            ("service_features", json!([])),
            ("data_directory", json!(data.join("other"))),
        ] {
            let mut invalid = status.clone();
            invalid[field] = wrong;
            assert!(ready(&endpoint, &invalid, 42, &data, &engine, "expected").is_err());
        }
    }
}
