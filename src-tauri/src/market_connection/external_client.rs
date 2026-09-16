//! Open an external client only after its normal user configuration still
//! points at the requested Market workspace. CLI clients use the global
//! managed-proxy configuration, so ORG2 must remain running while they work.
use agent_cli::managed_config::{self, CliConfigMode};

fn shell_word(value: &str) -> Result<String, String> {
    if value.contains(['\0', '\r', '\n']) {
        return Err("Invalid client launch path".into());
    }
    Ok(format!("'{}'", value.replace('\'', "'\\''")))
}

fn native_app(agent: &str) -> Option<(&'static str, Option<&'static str>, &'static str)> {
    match agent {
        "claude_desktop" => Some((
            "com.anthropic.claudefordesktop",
            Some("claude://code/new"),
            "Claude Desktop",
        )),
        "codex" => Some(("com.openai.codex", None, "Codex")),
        _ => None,
    }
}

pub async fn open(agent: String, key: String, model: String) -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Err("Opening Market clients is not available on this platform yet".into());
    }
    crate::harness_connections::verify_installed_version(&agent).await?;
    let selection = super::source::Selection::parse(&key, &agent)?;
    let entries = super::source::options(selection.metadata.clone()).await?;
    super::source::validate_session_purchase(
        &entries,
        &selection.workspace_id,
        &selection.entitlement_id,
        &agent,
        &model,
        chrono::Utc::now().timestamp_millis(),
    )?;
    let status = managed_config::cli_config_get_status(agent.clone()).await?;
    if !status.supported
        || status.conflict
        || status.mode != CliConfigMode::OrgiiManaged
        || status.selected_key_id.as_deref() != Some(&key)
        || status.selected_model.as_deref() != Some(&model)
    {
        return Err("Selected client configuration changed".into());
    }

    tokio::task::spawn_blocking(move || {
        if let Some((bundle_id, deep_link, display_name)) = native_app(&agent) {
            let mut command = std::process::Command::new("/usr/bin/open");
            command.args(["-b", bundle_id]);
            if let Some(value) = deep_link {
                command.arg(value);
            }
            let status = command
                .status()
                .map_err(|_| format!("Could not open {display_name}"))?;
            return if status.success() {
                Ok(())
            } else {
                Err(format!("Could not open {display_name}"))
            };
        }
        let executable = match agent.as_str() {
            "claude_code" => "claude",
            _ => return Err("Unsupported Market client".into()),
        };
        let folder = app_paths::orgii_root()
            .parent()
            .map(std::path::Path::to_path_buf)
            .ok_or("Home folder is unavailable")?;
        let cwd = shell_word(&folder.to_string_lossy())?;
        let command = shell_word(executable)?;
        let script = format!(
            "#!/bin/zsh -l\nset -e\nunset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN CLAUDE_CODE_OAUTH_TOKEN OPENAI_API_KEY\ncd -- {cwd}\nexec {command}\n"
        );
        let launcher = app_paths::orgii_root()
            .join("market")
            .join(format!("open-{agent}.command"));
        managed_config::write_cli_profile_file_atomic(&launcher, script.as_bytes())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&launcher, std::fs::Permissions::from_mode(0o700))
                .map_err(|_| "Could not prepare client launch")?;
        }
        let status = std::process::Command::new("/usr/bin/open")
            .args(["-a", "Terminal"])
            .arg(&launcher)
            .status()
            .map_err(|_| "Could not open your terminal")?;
        if status.success() {
            Ok(())
        } else {
            Err("Could not open your terminal".into())
        }
    })
    .await
    .map_err(|_| "Could not launch client")?
}

#[cfg(test)]
mod tests {
    use super::{native_app, shell_word};

    #[test]
    fn launch_paths_are_quoted_without_shell_expansion() {
        assert_eq!(
            shell_word("/Users/O'Neil/$(touch unwanted)").unwrap(),
            "'/Users/O'\\''Neil/$(touch unwanted)'"
        );
        assert!(shell_word("bad\npath").is_err());
    }

    #[test]
    fn opens_cli_in_terminal_and_desktop_clients_as_native_apps() {
        assert_eq!(native_app("claude_code"), None);
        assert_eq!(
            native_app("claude_desktop"),
            Some((
                "com.anthropic.claudefordesktop",
                Some("claude://code/new"),
                "Claude Desktop"
            ))
        );
        assert_eq!(
            native_app("codex"),
            Some(("com.openai.codex", None, "Codex"))
        );
    }
}
