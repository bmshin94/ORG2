//! Open an external client only after its configuration still points at the
//! requested Market workspace. Claude Code is launched with the ORG2-owned
//! overlay settings file; Codex and Claude Desktop use their own configuration
//! files. CLI clients talk to the local managed proxy, so ORG2 must remain
//! running while they work.
use agent_cli::managed_config::{self, CliConfigMode};

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
        crate::harness_connections::external_client::launch_claude(&status)
    })
    .await
    .map_err(|_| "Could not launch client")?
}

#[cfg(test)]
mod tests {
    use super::native_app;
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
