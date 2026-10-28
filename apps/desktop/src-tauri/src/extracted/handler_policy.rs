use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    sync::Arc,
    time::{Duration, Instant},
};
use tauri::Manager;
use terminus_engine_protocol::Error;

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "lowercase", deny_unknown_fields)]
pub(super) enum Action {
    List,
    Requests {
        name: String,
    },
    Approve {
        name: String,
        mcp: Option<String>,
        tool: Option<String>,
        #[serde(rename = "acceptHints")]
        accept_hints: Option<String>,
    },
    Revoke {
        name: String,
    },
    Release {
        name: Option<String>,
        identity: Option<String>,
    },
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Input {
    workspace: String,
    project: String,
    request: Action,
}

fn arguments(input: &Input) -> Result<(&'static str, Value), Error> {
    if input.workspace.is_empty() {
        return Err(Error::new("invalid_request"));
    }
    let (command, args) = match &input.request {
        Action::List => ("handler list", json!({})),
        Action::Requests { name } => ("handler requests", json!({"name":name})),
        Action::Revoke { name } => ("handler revoke", json!({"name":name})),
        Action::Approve {
            name,
            mcp,
            tool,
            accept_hints,
        } => {
            let mut args = json!({"name":name});
            for (key, value) in [("mcp", mcp), ("tool", tool), ("accept-hints", accept_hints)] {
                if let Some(value) = value {
                    args[key] = json!(value);
                }
            }
            ("handler approve", args)
        }
        Action::Release { name, identity } => {
            let mut args = json!({});
            if let Some(name) = name {
                args["name"] = json!(name);
            }
            if let Some(identity) = identity {
                args["identity"] = json!(identity);
            }
            if args.as_object().is_none_or(|o| o.is_empty()) {
                return Err(Error::new("invalid_request"));
            }
            ("handler release", args)
        }
    };
    Ok((command, args))
}

#[tauri::command(async)]
pub(super) fn handler_action(app: tauri::AppHandle, input: Input) -> Result<Value, Value> {
    let run = || -> Result<Value, Error> {
        let (command, args) = arguments(&input)?;
        let state = app
            .try_state::<Arc<super::proxy::State>>()
            .ok_or_else(|| Error::new("app_unavailable"))?;
        let client = state.client();
        let status = client.request("status", None, json!({}), Duration::from_secs(3))?;
        let capable = status["capabilities"]
            .as_array()
            .is_some_and(|routes| routes.iter().any(|route| route == command));
        if !capable {
            return Err(Error::new("unsupported"));
        }
        let mut result = client.request_scoped(
            command,
            Some(input.workspace.clone()),
            Some(input.project.clone()),
            args,
            Duration::from_secs(30),
        )?;
        if matches!(input.request, Action::List | Action::Requests { .. }) {
            return Ok(result);
        }
        let operation = result["id"]
            .as_str()
            .ok_or_else(|| Error::new("invalid_request"))?
            .to_owned();
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            match result["status"].as_str() {
                Some("completed") => return Ok(result["result"].clone()),
                Some("failed" | "interrupted") => {
                    return Err(serde_json::from_value(result["error"].clone())
                        .unwrap_or_else(|_| Error::new("operation_failed")))
                }
                _ => {}
            }
            if Instant::now() >= deadline {
                return Err(Error {
                    detail: json!({"operation":operation}),
                    ..Error::new("wait_timed_out")
                });
            }
            std::thread::sleep(Duration::from_millis(100));
            result = client
                .request(
                    "operation show",
                    Some(input.workspace.clone()),
                    json!({"operation":operation}),
                    Duration::from_secs(3),
                )
                .map_err(|error| Error {
                    detail: json!({"operation":operation,"cause":error}),
                    ..Error::new("operation_pending")
                })?;
        }
    };
    run().map_err(|error| super::proxy::failure(&error))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_declared_actions_and_arguments_cross_the_bridge() {
        let input: Input = serde_json::from_value(json!({"workspace":"w","project":"p","request":{"action":"approve","name":"reviewer","mcp":"notes=server","acceptHints":"network"}})).unwrap();
        let (command, args) = arguments(&input).unwrap();
        assert_eq!(command, "handler approve");
        assert_eq!(
            args,
            json!({"name":"reviewer","mcp":"notes=server","accept-hints":"network"})
        );
        assert!(serde_json::from_value::<Input>(
            json!({"workspace":"w","project":"p","request":{"action":"send"}})
        )
        .is_err());
        assert!(serde_json::from_value::<Input>(
            json!({"workspace":"w","project":"p","request":{"action":"release","caller_task":"x"}})
        )
        .is_err());
    }
}
