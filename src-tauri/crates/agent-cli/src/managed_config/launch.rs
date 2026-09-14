//! Session-owned launch profiles freeze the selected proxy generation. Switching
//! global configuration invalidates its token instead of rebinding this client.
use super::{
    config_operation_guard, file_io, generators,
    operations::{managed_selection_for_agent_unlocked, status_for_unlocked},
    recover_pending_transaction_unlocked, target_lock, CliConfigMode,
};
use serde::Serialize;
use std::{collections::BTreeMap, path::PathBuf};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedLaunchProfile {
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
}
fn profile_dir(session_id: &str) -> Result<PathBuf, String> {
    if session_id.is_empty()
        || session_id.len() > 128
        || !session_id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-'))
    {
        return Err("Invalid launch session".into());
    }
    Ok(app_paths::orgii_root()
        .join("managed-cli-launches")
        .join(session_id))
}

pub fn prepare(
    agent: &str,
    selection: &str,
    model: &str,
    session_id: &str,
) -> Result<ManagedLaunchProfile, String> {
    let _guard = config_operation_guard()?;
    let _lock = target_lock::lock_targets(agent)?;
    recover_pending_transaction_unlocked(agent)?;
    let status = status_for_unlocked(agent)?;
    if status.conflict
        || !matches!(status.mode, CliConfigMode::OrgiiManaged)
        || status.selected_key_id.as_deref() != Some(selection)
        || status.selected_model.as_deref() != Some(model)
    {
        return Err("Selected client configuration changed".into());
    }
    let selected = managed_selection_for_agent_unlocked(agent)?
        .ok_or("Selected client configuration is missing")?;
    let url = selected.proxy_url.ok_or("Managed proxy URL is missing")?;
    let token = selected
        .proxy_token
        .ok_or("Managed proxy token is missing")?;
    let (filename, content, env_name) = match agent {
        "codex" => (
            "config.toml",
            generators::generate_codex_managed_config("", Some(model), &url, &token)?,
            "CODEX_HOME",
        ),
        "claude_code" => (
            "settings.json",
            generators::generate_claude_code_managed_config("", Some(model), &url, &token)?,
            "CLAUDE_CONFIG_DIR",
        ),
        _ => return Err("Client launch profile is not supported".into()),
    };
    let directory = profile_dir(session_id)?;
    let parent = directory.parent().ok_or("Invalid launch directory")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    // Bound abandoned profiles without introducing a background cleanup timer.
    if std::fs::read_dir(parent)
        .map_err(|e| e.to_string())?
        .take(256)
        .count()
        >= 256
    {
        return Err("Too many retained client launch profiles".into());
    }
    std::fs::create_dir(&directory).map_err(|e| e.to_string())?;
    let result = (|| {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))
                .map_err(|e| e.to_string())?;
        }
        let config = directory.join(filename);
        file_io::write_sensitive_file_atomic(&config, content.as_bytes())?;
        let args = if agent == "claude_code" {
            vec![
                "--settings".into(),
                config.to_string_lossy().into_owned(),
                "--setting-sources".into(),
                "user".into(),
            ]
        } else {
            vec![]
        };
        Ok(ManagedLaunchProfile {
            args,
            env: BTreeMap::from([(env_name.into(), directory.to_string_lossy().into_owned())]),
        })
    })();
    if result.is_err() {
        let _ = std::fs::remove_dir_all(&directory);
    }
    result
}

pub fn release(session_id: &str) -> Result<(), String> {
    let directory = profile_dir(session_id)?;
    match std::fs::remove_dir_all(directory) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
