//! Open an external client only after its configuration still points at the
//! requested Market workspace. Claude Code is launched with the ORG2-owned
//! overlay settings file; Codex and Claude Desktop use their own configuration
//! files. CLI clients talk to the local managed proxy, so ORG2 must remain
//! running while they work.
use agent_cli::managed_config::{self, CliConfigMode};
use std::path::Path;

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

fn claude_launch_script(
    targets: &[managed_config::CliConfigTargetFileStatus],
    folder: &Path,
) -> Result<String, String> {
    let mut settings = targets.iter().filter(|target| target.id == "settings");
    let target = settings.next().ok_or("Claude Code settings are missing")?;
    if settings.next().is_some() {
        return Err("Claude Code settings are ambiguous".into());
    }
    if !target.overlay {
        return Err("Claude Code overlay settings are missing".into());
    }
    let path = Path::new(&target.target_path);
    if !path.is_absolute() || path.file_name().is_none_or(|name| name != "settings.json") {
        return Err("Invalid Claude Code settings path".into());
    }
    let overlay = shell_word(&path.to_string_lossy())?;
    let cwd = shell_word(&folder.to_string_lossy())?;
    // Terminal may already be running with a different environment. Layer the
    // ORG2-owned overlay over the user's own Claude Code configuration after
    // login-shell setup; the user's settings and history directory are used
    // as they are, so earlier conversations remain resumable.
    Ok(format!(
        "#!/bin/zsh -l\nset -e\nunset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL ANTHROPIC_MODEL CLAUDE_CODE_OAUTH_TOKEN OPENAI_API_KEY\ncd -- {cwd}\nexec 'claude' --settings {overlay}\n"
    ))
}

pub async fn open(agent: String, key: String, model: String) -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Err("Opening Market clients is not available on this platform yet".into());
    }
    let lease = super::owner::require()?;
    crate::harness_connections::verify_installed_version(&agent).await?;
    if key.starts_with("market-app:") {
        let catalog = super::app_catalog::Catalog::parse(&key, &agent)?;
        catalog.resolve(&model)?;
        catalog.validate_live().await?;
    } else {
        let selection = super::source::Selection::parse(&key, &agent)?;
        let entries = super::source::options(selection.metadata.clone()).await?;
        super::source::validate_external_purchase(
            &entries,
            &selection.workspace_id,
            &selection.entitlement_id,
            &agent,
            &model,
            chrono::Utc::now().timestamp_millis(),
        )?;
    }
    let status = managed_config::cli_config_get_status(agent.clone()).await?;
    if !status.supported
        || status.conflict
        || status.mode != CliConfigMode::OrgiiManaged
        || status.selected_key_id.as_deref() != Some(&key)
        || status.selected_model.as_deref() != Some(&model)
    {
        return Err("Selected client configuration changed".into());
    }

    let barrier = super::source::operation_barrier(&lease).await?;
    tokio::task::spawn_blocking(move || {
        let _barrier = barrier;
        lease.check()?;
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
        if agent != "claude_code" {
            return Err("Unsupported Market client".into());
        }
        let folder = app_paths::orgii_root()
            .parent()
            .map(std::path::Path::to_path_buf)
            .ok_or("Home folder is unavailable")?;
        let script = claude_launch_script(&status.target_files, &folder)?;
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
    use super::{claude_launch_script, native_app, shell_word};

    fn settings(path: &std::path::Path) -> agent_cli::managed_config::CliConfigTargetFileStatus {
        agent_cli::managed_config::CliConfigTargetFileStatus {
            id: "settings".into(),
            target_path: path.to_string_lossy().into_owned(),
            default_backup_path: String::new(),
            managed_profile_path: String::new(),
            target_exists: true,
            has_default_backup: false,
            default_was_missing: true,
            original_hash: None,
            last_applied_hash: None,
            current_hash: None,
            conflict: false,
            overlay: true,
        }
    }

    #[cfg(unix)]
    #[test]
    fn cli_launch_layers_the_overlay_over_the_users_own_configuration() {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::tempdir().unwrap();
        let bin = root.path().join("bin");
        let cwd = root.path().join("working directory's $(touch unwanted)");
        std::fs::create_dir(&bin).unwrap();
        std::fs::create_dir(&cwd).unwrap();
        let fake_cli = bin.join("claude");
        std::fs::write(
            &fake_cli,
            "#!/bin/sh\nprintf '%s\\n' \"${CLAUDE_CONFIG_DIR-unset}\" \"$PWD\" \"$#\" \"$1\" \"$2\" \"${ANTHROPIC_API_KEY-unset}\" \"${ANTHROPIC_AUTH_TOKEN-unset}\" \"${ANTHROPIC_BASE_URL-unset}\" \"${ANTHROPIC_MODEL-unset}\" \"${CLAUDE_CODE_OAUTH_TOKEN-unset}\" \"${OPENAI_API_KEY-unset}\"\n",
        )
        .unwrap();
        std::fs::set_permissions(&fake_cli, std::fs::Permissions::from_mode(0o700)).unwrap();
        for directory in [
            root.path().join("orgii/cli-config-profiles/claude_code/overlay"),
            root.path().join("overlay dir's $(touch unwanted)"),
        ] {
            let overlay = directory.join("settings.json");
            let script = claude_launch_script(&[settings(&overlay)], &cwd).unwrap();
            for inherited in [None, Some("/terminal/other-claude-home")] {
                let mut command = std::process::Command::new("/bin/sh");
                command
                    .args(["-c", &script])
                    .env_clear()
                    .env("PATH", &bin)
                    .env("ANTHROPIC_API_KEY", "fixture-key")
                    .env("ANTHROPIC_AUTH_TOKEN", "fixture-key")
                    .env("ANTHROPIC_BASE_URL", "https://terminal.invalid")
                    .env("ANTHROPIC_MODEL", "terminal-model")
                    .env("CLAUDE_CODE_OAUTH_TOKEN", "fixture-key")
                    .env("OPENAI_API_KEY", "fixture-key");
                if let Some(value) = inherited {
                    command.env("CLAUDE_CONFIG_DIR", value);
                }
                let output = command.output().unwrap();
                assert!(output.status.success(), "{:?}", output.stderr);
                let output = String::from_utf8(output.stdout).unwrap();
                let lines: Vec<_> = output.lines().collect();
                // The user's own Claude home is used as-is (never redirected).
                assert_eq!(lines[0], inherited.unwrap_or("unset"));
                assert_eq!(lines[1], cwd.to_string_lossy());
                assert_eq!(lines[2], "2");
                assert_eq!(lines[3], "--settings");
                assert_eq!(lines[4], overlay.to_string_lossy());
                assert_eq!(&lines[5..], &["unset"; 6]);
                assert!(!cwd.join("unwanted").exists());
            }
        }
    }

    #[test]
    fn cli_launch_rejects_missing_ambiguous_and_invalid_settings_paths() {
        let cwd = std::path::Path::new("/working");
        assert!(claude_launch_script(&[], cwd).is_err());
        let target = settings(std::path::Path::new("/config/settings.json"));
        assert!(claude_launch_script(&[target.clone(), target.clone()], cwd).is_err());
        let native = agent_cli::managed_config::CliConfigTargetFileStatus {
            overlay: false,
            ..target
        };
        assert!(claude_launch_script(&[native], cwd).is_err());
        for path in [
            "relative/settings.json",
            "/config/wrong.json",
            "/bad\npath/settings.json",
        ] {
            assert!(claude_launch_script(&[settings(std::path::Path::new(path))], cwd).is_err());
        }
    }

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
