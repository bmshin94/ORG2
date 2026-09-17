//! Explicit multi-purchase configuration. Fetch capabilities before any file
//! mutation; commit native picker, proxy selection and backups together.
use super::ConfigureCatalogRequest;
use super::{
    app_catalog::{alias, Catalog, CatalogModel},
    source, ConfiguredProfile,
};
use agent_cli::managed_config::model_catalog::{ModelCatalog, PickerModel};

async fn codex_metadata() -> Result<serde_json::Value, String> {
    use tokio::io::AsyncReadExt;
    let binary = integrations::cli_binary_resolver::resolve_cli_binary_for_registry_name("codex")
        .ok_or("Codex unavailable")?;
    let mut child = tokio::process::Command::new(binary.command)
        .args(["debug", "models", "--bundled"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| "Could not read the installed Codex model catalog")?;
    let stdout = child
        .stdout
        .take()
        .ok_or("Codex model catalog unavailable")?;
    let mut bytes = Vec::new();
    let status = tokio::time::timeout(std::time::Duration::from_secs(15), async {
        stdout
            .take(4 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .await
            .map_err(|_| "Codex model catalog unavailable")?;
        if bytes.len() > 4 * 1024 * 1024 {
            return Err("Codex model catalog too large");
        }
        child
            .wait()
            .await
            .map_err(|_| "Codex model catalog unavailable")
    })
    .await
    .map_err(|_| "Codex model catalog timed out")??;
    if !status.success() {
        return Err("Update Codex to a version supporting native model catalogs".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "Invalid installed Codex model catalog".into())
}

pub(super) async fn configure(
    request: ConfigureCatalogRequest,
) -> Result<ConfiguredProfile, String> {
    let lease = super::owner::require()?;
    let ConfigureCatalogRequest {
        packages,
        agent,
        default_package,
        default_model,
        expected_hashes,
    } = request;
    if packages.is_empty() || packages.len() > 8 || default_package >= packages.len() {
        return Err("Select between one and eight Market packages".into());
    }
    super::validate_external_profile_request(
        &market_connect::Target::Org2,
        &agent,
        &default_model,
    )?;
    crate::harness_connections::verify_installed_version(&agent).await?;
    if agent == "claude_code" {
        use integrations::cli_binary_resolver::{
            probe_cli_binary_version, resolve_cli_binary_for_registry_name,
        };
        let binary =
            resolve_cli_binary_for_registry_name(&agent).ok_or("Claude Code unavailable")?;
        let probe = probe_cli_binary_version(&binary).await;
        let version = probe.version.ok_or_else(|| match probe.error.as_deref() {
            Some(error) if !error.is_empty() => {
                format!("Claude Code version unavailable: {error}")
            }
            _ => "Claude Code version unavailable".to_string(),
        })?;
        let parts = version
            .trim_start_matches('v')
            .split('.')
            .map(str::parse::<u32>)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| "Unrecognized Claude Code version")?;
        if parts.len() != 3 || parts.as_slice() < [2, 1, 242].as_slice() {
            return Err(
                "Update Claude Code to 2.1.242 or newer to select packages inside the app".into(),
            );
        }
    }
    let metadata = if agent == "codex" {
        Some(codex_metadata().await?)
    } else {
        None
    };
    let mut catalog = Catalog {
        version: 1,
        agent: agent.clone(),
        default_model: String::new(),
        models: Vec::new(),
    };
    let mut picker = ModelCatalog { models: Vec::new() };
    let mut owners = std::collections::HashMap::new();
    let mut purchases = std::collections::HashSet::new();
    for (index, package) in packages.into_iter().enumerate() {
        if package.target != "org2"
            || !purchases.insert((
                package.entitlement_workspace_id.clone(),
                package.entitlement_id.clone(),
            ))
        {
            return Err("Invalid or duplicate Market package".into());
        }
        lease.matches(&package.identity_user_id)?;
        let connection = market_connect::ConnectionMetadata {
            identity_user_id: package.identity_user_id,
            workspace_id: package.workspace_id,
            target: market_connect::Target::Org2,
        };
        let owner = serde_json::to_string(&connection).map_err(|_| "Invalid Market identity")?;
        if !owners.contains_key(&owner) {
            owners.insert(owner.clone(), source::options(connection.clone()).await?);
        }
        let entries = &owners[&owner];
        let entry = entries
            .iter()
            .find(|entry| {
                entry.workspace_id == package.entitlement_workspace_id
                    && entry.entitlement_id == package.entitlement_id
            })
            .ok_or("Market package unavailable")?;
        let wire_agent = if agent == "codex" { "codex" } else { "claude" };
        let models = entry
            .models_by_agent
            .get(wire_agent)
            .ok_or("No compatible models in this package")?;
        let session_id = uuid::Uuid::new_v4().to_string();
        let previous_count = catalog.models.len();
        for model in models {
            // Unavailable/withdrawn models never enter the native picker.
            if source::validate_external_purchase(
                entries,
                &package.entitlement_workspace_id,
                &package.entitlement_id,
                &agent,
                model,
                chrono::Utc::now().timestamp_millis(),
            )
            .is_err()
            {
                continue;
            }
            let selection = source::Selection {
                native_protocol: None,
                metadata: connection.clone(),
                workspace_id: package.entitlement_workspace_id.clone(),
                entitlement_id: package.entitlement_id.clone(),
                model: Some(model.clone()),
                session_id: Some(session_id.clone()),
            };
            let id = alias(&selection)?;
            let native_metadata = if let Some(metadata) = &metadata {
                Some(metadata.get("models").and_then(serde_json::Value::as_array)
                    .and_then(|models| models.iter().find(|entry| entry.get("slug").and_then(serde_json::Value::as_str) == Some(model)))
                    .cloned().ok_or_else(|| format!("Installed Codex has no native metadata for {model}; update Codex before configuring this package"))?)
            } else {
                None
            };
            let label = format!("{} · {model}", entry.service_name);
            picker.models.push(PickerModel {
                id: id.clone(),
                label: label.clone(),
                native_metadata,
            });
            if index == default_package && model == &default_model {
                catalog.default_model = id.clone();
            }
            catalog.models.push(CatalogModel {
                id,
                label,
                selection: selection.key()?,
            });
            if catalog.models.len() > 64 {
                return Err("Selected packages exceed the 64-model native catalog limit".into());
            }
        }
        if catalog.models.len() == previous_count {
            return Err("A selected Market package has no currently available models".into());
        }
    }
    // Identical display names still need distinct native picker labels.
    let mut label_counts = std::collections::HashMap::new();
    for model in &catalog.models {
        *label_counts.entry(model.label.clone()).or_insert(0) += 1;
    }
    for (model, picker_model) in catalog.models.iter_mut().zip(&mut picker.models) {
        if label_counts
            .get(&model.label)
            .is_some_and(|count| *count > 1)
        {
            model.label = format!("{} · {}", model.label, &model.id[model.id.len() - 6..]);
            picker_model.label = model.label.clone();
        }
    }
    let selection = catalog.key()?;
    // Validate all entries before requesting any credential or editing config.
    let status = if agent == "claude_desktop" {
        crate::cli_managed_proxy::enable_dynamic_desktop(
            selection.clone(),
            catalog.default_model,
            catalog.models.into_iter().map(|model| model.id).collect(),
            expected_hashes,
            lease.operation(),
        )
        .await?
    } else {
        crate::cli_managed_proxy::enable_dynamic_catalog(
            agent,
            selection.clone(),
            catalog.default_model,
            picker,
            expected_hashes,
            lease.operation(),
        )
        .await?
    };
    Ok(ConfiguredProfile { status, selection })
}
