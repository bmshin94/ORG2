//! Open an external client only after its configuration still points at the
//! requested Market workspace. Claude Code is launched with the ORG2-owned
//! overlay settings file; Codex and Claude Desktop use an explicit isolated
//! configuration and Electron store. CLI clients talk to the local managed proxy, so ORG2 must remain
//! running while they work.
use agent_cli::managed_config::{self, CliConfigMode};

pub async fn open(agent: String, key: String, model: String) -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Err("Opening Market clients is not available on this platform yet".into());
    }
    let lease = super::owner::require()?;
    super::native_app_launch::verify_installed(&agent).await?;
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

    let native_app = lease.native_app(&agent)?;
    if let Some(profile) = &native_app {
        profile.validate_launch(&status)?;
    }
    let barrier = super::source::operation_barrier(&lease).await?;
    tokio::task::spawn_blocking(move || {
        let _barrier = barrier;
        lease.check()?;
        if let Some(profile) = native_app {
            // Re-read ownership under the current owner barrier immediately
            // before dispatch; a stale status cannot launch another profile.
            return agent_cli::managed_config::native_app::with_launch(
                &agent,
                &profile,
                &key,
                &model,
                || super::native_app_launch::open(&agent, &profile, || lease.check()),
            );
        }
        if agent != "claude_code" {
            return Err("Unsupported Market client".into());
        }
        crate::harness_connections::external_client::launch_claude(&status)
    })
    .await
    .map_err(|_| "Could not launch client")?
}
