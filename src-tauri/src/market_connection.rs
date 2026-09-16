//! Composition boundary for the removable Market module. Common client
//! configuration and credential crates do not depend on this module.
use serde::{Deserialize, Serialize};
#[cfg(feature = "market-connect")]
mod external_client;
#[cfg(feature = "market-connect")]
pub(crate) mod source;

pub(crate) fn register_source() -> Result<(), String> {
    #[cfg(feature = "market-connect")]
    crate::dynamic_credentials::register(source::instance())?;
    Ok(())
}

#[derive(Serialize)]
pub struct ConnectionView {
    identity_user_id: String,
    workspace_id: String,
    target: String,
    // Authorization is not a successful client configuration or model request.
    phase: &'static str,
}
#[derive(Serialize)]
pub struct ModuleStatus {
    enabled: bool,
    app_scheme: String,
    buyer_persistent_credentials: bool,
    connections: Vec<ConnectionView>,
}

#[derive(Serialize)]
pub struct PreparedSession {
    credential_source: String,
}

#[derive(Serialize)]
pub struct ConfiguredProfile {
    status: agent_cli::managed_config::CliConfigManagedStatus,
    selection: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfigureProfileRequest {
    identity_user_id: String,
    workspace_id: String,
    target: String,
    entitlement_workspace_id: String,
    entitlement_id: String,
    agent: String,
    model: String,
    expected_hashes: std::collections::BTreeMap<String, Option<String>>,
}

#[cfg(feature = "market-connect")]
fn validate_external_profile_request(
    target: &market_connect::Target,
    agent: &str,
    model: &str,
) -> Result<(), String> {
    if target != &market_connect::Target::Org2 {
        return Err("Market profile requires ORG2 authorization".into());
    }
    if !matches!(agent, "claude_code" | "claude_desktop" | "codex") {
        return Err("Unsupported Market profile app".into());
    }
    if model.trim().is_empty() || model.len() > 256 {
        return Err("Unsupported Market profile model".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn market_connection_begin(raw: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || enabled::begin(raw))
        .await
        .map_err(|_| "market_connection_unavailable")?
}
#[tauri::command]
pub async fn market_connection_complete(raw: String) -> Result<ConnectionView, String> {
    enabled::complete(raw).await
}
#[tauri::command]
pub async fn market_connection_cancel() -> Result<(), String> {
    tokio::task::spawn_blocking(enabled::cancel)
        .await
        .map_err(|_| "market_connection_unavailable")?
}
#[tauri::command(rename_all = "camelCase")]
pub async fn market_connection_options(
    identity_user_id: String,
    workspace_id: String,
    target: String,
) -> Result<serde_json::Value, String> {
    #[cfg(feature = "market-connect")]
    {
        let target: market_connect::Target =
            serde_json::from_value(serde_json::Value::String(target))
                .map_err(|_| "Invalid Market target")?;
        let entries = source::options(market_connect::ConnectionMetadata {
            identity_user_id,
            workspace_id,
            target,
        })
        .await?;
        serde_json::to_value(entries).map_err(|_| "Market workspace response unavailable".into())
    }
    #[cfg(not(feature = "market-connect"))]
    {
        let _ = (identity_user_id, workspace_id, target);
        Err("market_module_disabled".into())
    }
}

#[tauri::command(rename_all = "camelCase")]
pub async fn market_connection_prepare_session(
    identity_user_id: String,
    workspace_id: String,
    target: String,
    entitlement_workspace_id: String,
    entitlement_id: String,
    agent: String,
    model: String,
) -> Result<PreparedSession, String> {
    #[cfg(feature = "market-connect")]
    {
        let target: market_connect::Target =
            serde_json::from_value(serde_json::Value::String(target))
                .map_err(|_| "Invalid Market target")?;
        let credential_source = source::prepare_session(
            market_connect::ConnectionMetadata {
                identity_user_id,
                workspace_id,
                target,
            },
            entitlement_workspace_id,
            entitlement_id,
            agent,
            model,
        )
        .await?;
        Ok(PreparedSession { credential_source })
    }
    #[cfg(not(feature = "market-connect"))]
    {
        let _ = (
            identity_user_id,
            workspace_id,
            target,
            entitlement_workspace_id,
            entitlement_id,
            agent,
            model,
        );
        Err("market_module_disabled".into())
    }
}

/// Configure an external client from the same ORG2-scoped purchase profile
/// used by native sessions. The opaque selection is minted only after the
/// entitlement/model check succeeds and no provider secret is persisted.
#[tauri::command(rename_all = "camelCase")]
pub async fn market_connection_configure_profile(
    request: ConfigureProfileRequest,
) -> Result<ConfiguredProfile, String> {
    #[cfg(feature = "market-connect")]
    {
        let ConfigureProfileRequest {
            identity_user_id,
            workspace_id,
            target,
            entitlement_workspace_id,
            entitlement_id,
            agent,
            model,
            expected_hashes,
        } = request;
        let target: market_connect::Target =
            serde_json::from_value(serde_json::Value::String(target))
                .map_err(|_| "Invalid Market target")?;
        validate_external_profile_request(&target, &agent, &model)?;
        crate::harness_connections::verify_installed_version(&agent).await?;
        let selection = source::prepare_session(
            market_connect::ConnectionMetadata {
                identity_user_id,
                workspace_id,
                target,
            },
            entitlement_workspace_id,
            entitlement_id,
            agent.clone(),
            model.clone(),
        )
        .await?;
        let status = if agent == "claude_desktop" {
            let parsed = source::Selection::parse(&selection, &agent)?;
            let entries = source::options(parsed.metadata.clone()).await?;
            let models = entries
                .iter()
                .find(|entry| {
                    entry.workspace_id == parsed.workspace_id
                        && entry.entitlement_id == parsed.entitlement_id
                })
                .and_then(|entry| entry.models_by_agent.get("claude"))
                .cloned()
                .ok_or("No Claude models available")?;
            crate::cli_managed_proxy::enable_dynamic_desktop(
                selection.clone(),
                model,
                models,
                expected_hashes,
            )
            .await?
        } else {
            crate::cli_managed_proxy::enable_dynamic_managed(
                agent,
                selection.clone(),
                model,
                expected_hashes,
            )
            .await?
        };
        Ok(ConfiguredProfile { status, selection })
    }
    #[cfg(not(feature = "market-connect"))]
    {
        let _ = request;
        Err("market_module_disabled".into())
    }
}

#[cfg(all(test, feature = "market-connect"))]
mod profile_tests {
    use super::*;

    #[test]
    fn configure_profile_request_is_one_strict_camel_case_payload() {
        let value = serde_json::json!({
            "identityUserId": "11111111-1111-4111-8111-111111111111",
            "workspaceId": "ws_identity",
            "target": "org2",
            "entitlementWorkspaceId": "ws_purchase",
            "entitlementId": "ent_purchase",
            "agent": "codex",
            "model": "gpt-example",
            "expectedHashes": { "config": "sha256:example" }
        });
        assert!(serde_json::from_value::<ConfigureProfileRequest>(value.clone()).is_ok());
        let mut unknown = value;
        unknown["legacyField"] = serde_json::Value::Bool(true);
        assert!(serde_json::from_value::<ConfigureProfileRequest>(unknown).is_err());
    }

    #[test]
    fn prepared_session_contains_only_the_opaque_credential_source() {
        let value = serde_json::to_value(PreparedSession {
            credential_source: "market:opaque".into(),
        })
        .unwrap();
        assert_eq!(
            value,
            serde_json::json!({ "credential_source": "market:opaque" })
        );
    }

    #[test]
    fn external_profiles_require_org2_authorization_and_supported_apps() {
        assert!(validate_external_profile_request(
            &market_connect::Target::Org2,
            "claude_code",
            "claude-model"
        )
        .is_ok());
        assert!(validate_external_profile_request(
            &market_connect::Target::Org2,
            "claude_desktop",
            "claude-model"
        )
        .is_ok());
        assert!(validate_external_profile_request(
            &market_connect::Target::Org2,
            "codex",
            "codex-model"
        )
        .is_ok());
        assert!(validate_external_profile_request(
            &market_connect::Target::Codex,
            "codex",
            "codex-model"
        )
        .is_err());
        assert!(validate_external_profile_request(
            &market_connect::Target::Org2,
            "unknown",
            "model"
        )
        .is_err());
        assert!(
            validate_external_profile_request(&market_connect::Target::Org2, "codex", "").is_err()
        );
    }
}

#[tauri::command]
pub async fn market_connection_status() -> Result<ModuleStatus, String> {
    enabled::status().await
}

#[cfg(feature = "market-connect")]
mod enabled {
    use super::*;
    use market_connect::{ConnectionMetadata, Enrollment};
    use std::sync::{Mutex, OnceLock};

    static ENROLLMENT: OnceLock<Mutex<Enrollment>> = OnceLock::new();
    fn owner() -> &'static Mutex<Enrollment> {
        ENROLLMENT.get_or_init(Default::default)
    }
    fn index_path() -> std::path::PathBuf {
        app_paths::orgii_root()
            .join("market")
            .join("connections.json")
    }
    pub(super) fn read_index() -> Result<Vec<ConnectionMetadata>, String> {
        let path = index_path();
        let mut file = match std::fs::File::open(&path) {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(_) => return Err("market_connection_index_unavailable".into()),
        };
        let mut bytes = Vec::new();
        use std::io::Read;
        (&mut file)
            .take(32769)
            .read_to_end(&mut bytes)
            .map_err(|_| "market_connection_index_unavailable")?;
        if bytes.len() > 32768 {
            return Err("market_connection_index_too_large".into());
        }
        let records: Vec<ConnectionMetadata> =
            serde_json::from_slice(&bytes).map_err(|_| "market_connection_index_invalid")?;
        if records.len() > 32 {
            return Err("market_connection_limit".into());
        }
        Ok(records)
    }
    fn view(record: ConnectionMetadata, phase: &'static str) -> ConnectionView {
        ConnectionView {
            identity_user_id: record.identity_user_id,
            workspace_id: record.workspace_id,
            target: record.target.wire_name().into(),
            phase,
        }
    }
    pub fn begin(raw: String) -> Result<String, String> {
        market_connect::require_buyer_credential_store()?;
        let selection =
            market_connect::parse_selection(&raw).ok_or("invalid_market_connection_link")?;
        owner()
            .lock()
            .map_err(|_| "market_connection_unavailable")?
            .begin(selection)
            .map_err(Into::into)
    }
    pub fn cancel() -> Result<(), String> {
        owner()
            .lock()
            .map_err(|_| "market_connection_unavailable")?
            .cancel();
        Ok(())
    }
    pub async fn complete(raw: String) -> Result<ConnectionView, String> {
        // Also gate cold callbacks before consuming or exchanging a code.
        market_connect::require_buyer_credential_store()?;
        let redemption = owner()
            .lock()
            .map_err(|_| "market_connection_unavailable")?
            .take_redemption(&raw)?;
        let attempt = redemption.attempt_id().to_owned();
        let grant = match redemption.exchange().await {
            Ok(grant) => grant,
            Err(error) => {
                owner()
                    .lock()
                    .map_err(|_| "market_connection_unavailable")?
                    .cancel_attempt(&attempt);
                return Err(error.into());
            }
        };
        // Wait for native renewal commits before replacing an authorization.
        // Retire cached access so the next request reads the new OS-store grant.
        let source_guard = super::source::retire_for_reauthorization().await;
        tokio::task::spawn_blocking(move || {
            let _source_guard = source_guard;
            // Serialize index updates and cancellation with the final secret-store write.
            let mut enrollment = owner()
                .lock()
                .map_err(|_| "market_connection_unavailable")?;
            let mut records = match read_index() {
                Ok(records) => records,
                Err(error) => {
                    enrollment.cancel_attempt(&attempt);
                    return Err(error);
                }
            };
            let metadata = grant.metadata();
            let existing = records.iter().position(|r| *r == metadata);
            if existing.is_none() && records.len() >= 32 {
                enrollment.cancel_attempt(&attempt);
                return Err("market_connection_limit".into());
            }
            let scope = app_paths::orgii_root().to_string_lossy().into_owned();
            if existing.is_none() {
                records.push(metadata.clone());
            }
            let bytes =
                serde_json::to_vec(&records).map_err(|_| "market_connection_index_invalid")?;
            let metadata = enrollment.store_authorized(grant, &scope, || {
                agent_cli::managed_config::write_cli_profile_file_atomic(&index_path(), &bytes)
                    .map_err(|_| "market_connection_index_unavailable")
            })?;
            Ok(view(metadata, "authorization_saved"))
        })
        .await
        .map_err(|_| "market_connection_unavailable")?
    }
    pub async fn status() -> Result<ModuleStatus, String> {
        tokio::task::spawn_blocking(|| {
            Ok(ModuleStatus {
                enabled: true,
                app_scheme: market_connect::app_scheme()?.to_string(),
                buyer_persistent_credentials: market_connect::buyer_credential_store_supported(),
                connections: read_index()?
                    .into_iter()
                    .map(|record| {
                        let scope = app_paths::orgii_root().to_string_lossy().into_owned();
                        let phase = if market_connect::Grant::load(&scope, &record).is_ok() {
                            "authorization_saved"
                        } else {
                            "reauthorization_required"
                        };
                        view(record, phase)
                    })
                    .collect(),
            })
        })
        .await
        .map_err(|_| "market_connection_unavailable")?
    }
}

#[cfg(not(feature = "market-connect"))]
mod enabled {
    use super::*;
    pub fn begin(_: String) -> Result<String, String> {
        Err("market_module_disabled".into())
    }
    pub async fn complete(_: String) -> Result<ConnectionView, String> {
        Err("market_module_disabled".into())
    }
    pub fn cancel() -> Result<(), String> {
        Ok(())
    }
    pub async fn status() -> Result<ModuleStatus, String> {
        Ok(ModuleStatus {
            enabled: false,
            app_scheme: "orgii".into(),
            buyer_persistent_credentials: false,
            connections: Vec::new(),
        })
    }
}

#[tauri::command(rename_all = "camelCase")]
pub async fn market_connection_open_client(
    agent: String,
    selection: String,
    model: String,
) -> Result<(), String> {
    #[cfg(feature = "market-connect")]
    {
        external_client::open(agent, selection, model).await
    }
    #[cfg(not(feature = "market-connect"))]
    {
        let _ = (agent, selection, model);
        Err("market_module_disabled".into())
    }
}
