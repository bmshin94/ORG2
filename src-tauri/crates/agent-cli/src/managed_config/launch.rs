//! Session-owned native homes keep launch configuration separate from history.
//! The application can bind a profile to an independently owned local route.
use super::{
    config_operation_guard, file_io, generators,
    operations::{managed_selection_for_agent_unlocked, status_for_unlocked},
    recover_pending_transaction_unlocked, target_lock, CliConfigMode,
};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::PathBuf};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedLaunchProfile {
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
}
#[derive(Serialize, Deserialize)]
struct OwnedConfig {
    filename: String,
    hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pending_hash: Option<String>,
}
const OWNED_CONFIG: &str = ".org2-launch-config.json";

fn profile_dir(session_id: &str) -> Result<PathBuf, String> {
    if session_id.is_empty()
        || session_id.len() > 128
        || !session_id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-'))
    {
        return Err("Invalid launch session".into());
    }
    Ok(app_paths::managed_cli_launch_root().join(session_id))
}

/// The persistent native store used by this Session's launch environment.
/// Resolving it does not create a profile or require a live credential.
pub fn native_home(session_id: &str) -> Result<PathBuf, String> {
    profile_dir(session_id)
}

pub fn prepare(
    agent: &str,
    selection: &str,
    model: &str,
    session_id: &str,
) -> Result<ManagedLaunchProfile, String> {
    prepare_with_proxy_token(agent, selection, model, session_id, None)
}

/// The application may supply a session-owned local proxy token. Global
/// selection/conflict validation still runs before any profile is written.
pub fn prepare_with_proxy_token(
    agent: &str,
    selection: &str,
    model: &str,
    session_id: &str,
    session_proxy_token: Option<&str>,
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
    let token = session_proxy_token.unwrap_or(&token);
    write_profile(agent, model, session_id, &url, token, false)
}

/// Restore the Session-owned home using a newly authorized local route. The
/// application supplies the durable source; global account selection is not
/// consulted. Existing config is replaced only when its ownership is proven.
pub fn restore_with_proxy_token(
    agent: &str,
    model: &str,
    session_id: &str,
    url: &str,
    token: &str,
) -> Result<ManagedLaunchProfile, String> {
    let _guard = config_operation_guard()?;
    write_profile(agent, model, session_id, url, token, true)
}

fn owned_hash_matches(owned: &OwnedConfig, hash: &str) -> bool {
    owned.hash == hash || owned.pending_hash.as_deref() == Some(hash)
}

fn write_profile(
    agent: &str,
    model: &str,
    session_id: &str,
    url: &str,
    token: &str,
    restore: bool,
) -> Result<ManagedLaunchProfile, String> {
    let (filename, content, env_name) = match agent {
        "codex" => (
            "config.toml",
            generators::generate_codex_managed_config("", Some(model), url, token)?,
            "CODEX_HOME",
        ),
        "claude_code" => (
            "settings.json",
            generators::generate_claude_code_managed_config("", Some(model), url, token)?,
            "CLAUDE_CONFIG_DIR",
        ),
        _ => return Err("Client launch profile is not supported".into()),
    };
    let directory = profile_dir(session_id)?;
    let parent = directory.parent().ok_or("Invalid launch directory")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    // Bound abandoned profiles without introducing a background cleanup timer.
    if !(restore && directory.join(OWNED_CONFIG).is_file())
        && std::fs::read_dir(parent)
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .filter(|entry| entry.path().join(OWNED_CONFIG).exists())
            .take(256)
            .count()
            >= 256
    {
        return Err("Too many retained client launch profiles".into());
    }
    let existed = match std::fs::symlink_metadata(&directory) {
        Ok(metadata) => {
            if !restore || !metadata.is_dir() || metadata.file_type().is_symlink() {
                return Err("Launch directory is not available for restoration".into());
            }
            true
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            std::fs::create_dir(&directory).map_err(|error| error.to_string())?;
            false
        }
        Err(error) => return Err(error.to_string()),
    };
    let config = directory.join(filename);
    let marker_path = directory.join(OWNED_CONFIG);
    let previous_hash = if restore {
        let marker = match std::fs::read(&marker_path) {
            Ok(bytes) => {
                Some(serde_json::from_slice::<OwnedConfig>(&bytes).map_err(|e| e.to_string())?)
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(error.to_string()),
        };
        if marker
            .as_ref()
            .is_some_and(|owned| owned.filename != filename)
        {
            return Err("Launch configuration belongs to another client".into());
        }
        let hash = file_io::file_hash(&config)?;
        if let Some(hash) = &hash {
            if !marker
                .as_ref()
                .is_some_and(|owned| owned_hash_matches(owned, hash))
            {
                return Err("Launch configuration was externally modified".into());
            }
        }
        hash
    } else {
        None
    };
    let result = (|| {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))
                .map_err(|e| e.to_string())?;
        }
        let hash = file_io::sha256_bytes(content.as_bytes());
        // Publish both allowed hashes before replacing the config. A crash on
        // either side of the write is retryable without accepting external edits.
        {
            let intent = serde_json::to_vec(&OwnedConfig {
                filename: filename.into(),
                hash: previous_hash.clone().unwrap_or_default(),
                pending_hash: Some(hash.clone()),
            })
            .map_err(|e| e.to_string())?;
            file_io::write_sensitive_file_atomic(&marker_path, &intent)?;
        }
        file_io::write_sensitive_file_atomic(&config, content.as_bytes())?;
        let marker = serde_json::to_vec(&OwnedConfig {
            filename: filename.into(),
            hash,
            pending_hash: None,
        })
        .map_err(|e| e.to_string())?;
        file_io::write_sensitive_file_atomic(&marker_path, &marker)?;
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
    if result.is_err() && !existed && !restore {
        // A failed preparation must not recursively delete any client data.
        let _ = std::fs::remove_file(directory.join(filename));
        let _ = std::fs::remove_file(directory.join(OWNED_CONFIG));
        let _ = std::fs::remove_dir(&directory);
    }
    result
}

pub fn release(session_id: &str) -> Result<(), String> {
    let directory = profile_dir(session_id)?;
    let marker = directory.join(OWNED_CONFIG);
    let bytes = match std::fs::read(&marker) {
        Ok(bytes) => bytes,
        // Older unmarked homes must be retained: ownership is not proven.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.to_string()),
    };
    let owned: OwnedConfig = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    if !matches!(owned.filename.as_str(), "config.toml" | "settings.json") {
        return Err("Invalid owned launch configuration".into());
    }
    let config = directory.join(&owned.filename);
    if let Some(hash) = file_io::file_hash(&config)? {
        if !owned_hash_matches(&owned, &hash) {
            return Err("Launch configuration was externally modified".into());
        }
        std::fs::remove_file(config).map_err(|e| e.to_string())?;
    }
    std::fs::remove_file(marker).map_err(|e| e.to_string())?;
    // Only an empty directory may be removed. Sessions/history and all other
    // native state remain in their original home for later history discovery.
    match std::fs::remove_dir(directory) {
        Ok(()) => Ok(()),
        Err(e)
            if matches!(
                e.kind(),
                std::io::ErrorKind::NotFound | std::io::ErrorKind::DirectoryNotEmpty
            ) =>
        {
            Ok(())
        }
        Err(e) => Err(e.to_string()),
    }
}
