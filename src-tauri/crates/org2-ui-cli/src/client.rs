use crate::args::Flags;
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, time::Duration};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Endpoint {
    instance_id: String,
    port: u16,
    token: String,
}
fn read_endpoint(path: &std::path::Path) -> Option<Endpoint> {
    if fs::symlink_metadata(path).map_or(true, |m| !m.is_file() || m.len() > 8192) {
        return None;
    }
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}
fn endpoints(instance: Option<&String>) -> Result<Vec<Endpoint>, String> {
    let dir = app_paths::orgii_root().join("ui/instances");
    if !dir.exists() {
        return Ok(vec![]);
    }
    if let Some(instance) = instance {
        let id = uuid::Uuid::parse_str(instance).map_err(|_| "Invalid instance ID")?;
        return Ok(read_endpoint(&dir.join(format!("{id}.json")))
            .into_iter()
            .collect());
    }
    let mut result = Vec::new();
    for (index, entry) in fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .take(1025)
        .enumerate()
    {
        if index == 1024 {
            return Err("Discovery directory is too large; select a known --instance or inspect stale descriptors in ORGII_HOME/ui/instances".into());
        }
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        if let Some(endpoint) = read_endpoint(&path) {
            result.push(endpoint);
        }
        if result.len() > 64 {
            return Err("Discovery exceeds 64 endpoint candidates; select a known --instance or inspect stale descriptors in ORGII_HOME/ui/instances".into());
        }
    }
    Ok(result)
}
fn client() -> Result<Client, String> {
    // This entry point intentionally runs before the desktop bootstrap.
    // An already-installed provider is valid when called from the app binary.
    let _ = tokio_rustls::rustls::crypto::ring::default_provider().install_default();
    Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_millis(500))
        .timeout(Duration::from_secs(32))
        .build()
        .map_err(|e| e.to_string())
}
fn info(client: &Client, endpoint: &Endpoint) -> Option<Value> {
    let response: Value = client
        .get(format!("http://127.0.0.1:{}/ui/v1/info", endpoint.port))
        .header("x-orgii-ui-token", &endpoint.token)
        .timeout(Duration::from_millis(750))
        .send()
        .ok()?
        .error_for_status()
        .ok()?
        .json()
        .ok()?;
    (response["instanceId"] == endpoint.instance_id).then_some(response)
}
pub fn execute(words: Vec<String>, flags: Flags) -> Result<Value, String> {
    let client = client()?;
    let mut live = Vec::new();
    for endpoint in endpoints(flags.get("instance"))? {
        if flags
            .get("instance")
            .is_some_and(|id| *id != endpoint.instance_id)
        {
            continue;
        }
        if let Some(state) = info(&client, &endpoint) {
            live.push((endpoint, state));
        }
    }
    if words == ["instances"] {
        return Ok(json!({"instances":live.iter().map(|(_, state)| json!({
            "instanceId":state["instanceId"], "ready":state["ready"],
            "windows":state["windows"], "catalogHash":state["catalogHash"],
            "protocolVersion":state["protocolVersion"]
        })).collect::<Vec<_>>()}));
    }
    if live.is_empty() {
        return Ok(
            json!({"status":"failed","error":{"code":"APP_NOT_RUNNING","message":"No authenticated ORG2 UI endpoint in this ORGII_HOME"}}),
        );
    }
    if live.len() != 1 {
        return Err("Multiple ORG2 instances; pass --instance".into());
    }
    let (endpoint, state) = live.remove(0);
    if words == ["capabilities"] {
        return Ok(state);
    }
    if words == ["windows"] {
        return Ok(json!({"instanceId":endpoint.instance_id,"windows":state["windows"]}));
    }
    if state["catalogHash"] != app_ui::catalog()["hash"] {
        return Ok(
            json!({"status":"failed","error":{"code":"PROTOCOL_MISMATCH","message":"CLI and app catalogs differ"}}),
        );
    }
    if words.first().is_some_and(|s| s == "request") {
        if words.get(1).map(String::as_str) != Some("status") || words.len() != 3 {
            return Err("Use request status <request-id>".into());
        }
        return client
            .get(format!("http://127.0.0.1:{}/ui/v1/receipt", endpoint.port))
            .header("x-orgii-ui-token", endpoint.token)
            .query(&[("requestId", &words[2])])
            .send()
            .map_err(|e| e.to_string())?
            .json()
            .map_err(|e| e.to_string());
    }
    let (command, params) = command_params(&words, &flags)?;
    if flags.contains_key("target-file")
        && ["window", "session", "global"]
            .iter()
            .any(|key| flags.contains_key(*key))
    {
        return Err("--target-file cannot be combined with target options".into());
    }
    let target = if let Some(path) = flags.get("target-file") {
        read_json(path)?
    } else {
        if flags.contains_key("session") && flags.contains_key("global") {
            return Err("--session and --global are mutually exclusive".into());
        }
        let workspace = if let Some(session) = flags.get("session") {
            json!({"kind":"session","sessionId":session})
        } else if flags.contains_key("global") || command == "ui.context" {
            json!({"kind":"global"})
        } else {
            return Err("Specify --session <id> or --global".into());
        };
        json!({"instanceId":endpoint.instance_id,"windowId":flags.get("window").map(String::as_str).unwrap_or("main"),"workspace":workspace})
    };
    let id = flags
        .get("request-id")
        .cloned()
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let request = json!({"protocolVersion":1,"requestId":id,"command":command,"target":target,"params":params,"reveal":flags.contains_key("reveal"),"timeoutMs":10000});
    match client
        .post(format!("http://127.0.0.1:{}/ui/v1/execute", endpoint.port))
        .header("x-orgii-ui-token", endpoint.token)
        .json(&request)
        .send()
    {
        Ok(response) => response.json().map_err(|e| e.to_string()),
        Err(_) => Ok(
            json!({"protocolVersion":1,"requestId":id,"target":target,"status":"unknown","error":{"code":"DEADLINE_EXCEEDED","message":"Transport ended without a receipt; inspect request status"}}),
        ),
    }
}
fn read_json(path: &str) -> Result<Value, String> {
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.len() > app_ui::MAX_BODY as u64 {
        return Err("Expected a regular JSON file of at most 64 KiB".into());
    }
    serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}
fn command_params(words: &[String], flags: &Flags) -> Result<(String, Value), String> {
    let catalog = app_ui::catalog();
    let generic = words.first().is_some_and(|s| s == "exec");
    let entry = catalog["commands"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| {
            if generic {
                words.get(1).is_some_and(|s| c["id"] == *s)
            } else {
                c["cli"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .enumerate()
                    .all(|(i, v)| words.get(i).is_some_and(|s| v == s))
            }
        })
        .ok_or("Unknown UI command; use org2 ui docs --list")?;
    let mut params = if let Some(path) = flags.get("params-file") {
        read_json(path)?
    } else {
        json!({})
    };
    if !params.is_object() {
        return Err("params-file must contain a JSON object".into());
    }
    let properties = entry["params"]["properties"].as_object().unwrap();
    let cli_len = entry["cli"].as_array().unwrap().len();
    let positional = entry["positional"].as_str();
    if generic {
        if words.len() != 2 {
            return Err("exec requires exactly one command ID".into());
        }
    } else {
        let expected = cli_len + usize::from(positional.is_some());
        if words.len() != expected {
            return Err(format!("Incorrect arguments for {}", entry["id"]));
        }
        if let Some(name) = positional {
            params[name] = json!(words[cli_len]);
        }
    }
    for (flag, value) in flags {
        if matches!(
            flag.as_str(),
            "instance"
                | "window"
                | "session"
                | "global"
                | "json"
                | "reveal"
                | "request-id"
                | "params-file"
                | "target-file"
        ) {
            continue;
        }
        let schema = properties
            .get(flag)
            .ok_or_else(|| format!("Unknown option --{flag}"))?;
        params[flag] = if schema["type"] == "integer" {
            json!(value
                .parse::<u64>()
                .map_err(|_| format!("--{flag} must be an integer"))?)
        } else {
            json!(value)
        };
    }
    Ok((entry["id"].as_str().unwrap().into(), params))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn words(values: &[&str]) -> Vec<String> {
        values.iter().map(|s| (*s).into()).collect()
    }
    #[test]
    fn common_commands_follow_the_catalog_and_reject_unknown_options() {
        let mut flags = Flags::new();
        flags.insert("line".into(), "42".into());
        flags.insert("global".into(), "true".into());
        let (id, params) = command_params(&words(&["file", "open", "file.ts"]), &flags).unwrap();
        assert_eq!(id, "ui.file.open");
        assert_eq!(params, json!({"path":"file.ts","line":42}));
        flags.insert("unexpected".into(), "yes".into());
        assert!(command_params(&words(&["file", "open", "file.ts"]), &flags).is_err());
        assert!(command_params(&words(&["file", "open"]), &Flags::new()).is_err());
        assert!(command_params(&words(&["exec", "gui.execute"]), &Flags::new()).is_err());
    }
    #[test]
    fn non_numeric_line_is_a_parse_error() {
        let mut flags = Flags::new();
        flags.insert("line".into(), "$(touch impossible)".into());
        assert!(command_params(&words(&["file", "open", "file.ts"]), &flags).is_err());
    }
    #[test]
    fn terminal_commands_keep_explicit_ids_and_literal_input() {
        let mut flags = Flags::new();
        flags.insert("command".into(), "echo '$HOME'".into());
        let (id, params) =
            command_params(&words(&["terminal", "execute", "shell-one"]), &flags).unwrap();
        assert_eq!(id, "ui.terminal.execute");
        assert_eq!(
            params,
            json!({"terminalId":"shell-one","command":"echo '$HOME'"})
        );
        assert!(command_params(&words(&["terminal", "execute"]), &flags).is_err());
        let mut flags = Flags::new();
        flags.insert("maxBytes".into(), "512".into());
        assert_eq!(
            command_params(&words(&["terminal", "read", "shell-one"]), &flags)
                .unwrap()
                .1,
            json!({"terminalId":"shell-one","maxBytes":512})
        );
    }
}
