use crate::dynamic_credentials::{Authentication, Credential, Destination, Source};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use market_connect::{Connection, ConnectionMetadata, WorkspaceCredential};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Arc};

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Selection {
    pub metadata: ConnectionMetadata,
    pub entitlement_id: String,
}
impl Selection {
    pub(super) fn key(&self) -> Result<String, String> {
        Ok(format!(
            "market:{}",
            URL_SAFE_NO_PAD
                .encode(serde_json::to_vec(self).map_err(|_| "Invalid Market selection")?)
        ))
    }
    fn parse(value: &str, agent: &str) -> Result<Self, String> {
        if value.len() > 1024 {
            return Err("Invalid Market selection".into());
        }
        let bytes = URL_SAFE_NO_PAD
            .decode(
                value
                    .strip_prefix("market:")
                    .ok_or("Invalid Market selection")?,
            )
            .map_err(|_| "Invalid Market selection")?;
        let selection: Self =
            serde_json::from_slice(&bytes).map_err(|_| "Invalid Market selection")?;
        if uuid::Uuid::parse_str(&selection.metadata.identity_user_id).is_err()
            || !selection.metadata.workspace_id.starts_with("ws_")
            || !(4..=123).contains(&selection.metadata.workspace_id.len())
            || !selection
                .metadata
                .workspace_id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
            || selection.metadata.target.harness_name() != Some(agent)
            || !selection.entitlement_id.starts_with("ent_")
            || selection.entitlement_id.len() > 64
            || !selection
                .entitlement_id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
        {
            return Err("Market client selection mismatch".into());
        }
        Ok(selection)
    }
}
#[derive(Default)]
pub(super) struct State {
    connections: HashMap<String, Arc<Connection>>,
    credentials: HashMap<String, WorkspaceCredential>,
}
#[derive(Default)]
pub(super) struct MarketSource {
    state: Arc<tokio::sync::Mutex<State>>,
}
impl Source for MarketSource {
    fn namespace(&self) -> &'static str {
        "market"
    }
    fn destination(&self, key: &str, agent: &str) -> Result<Destination, String> {
        let selection = Selection::parse(key, agent)?;
        Ok(Destination {
            provider: "market".into(),
            authentication: Authentication::Bearer,
            base_url: format!(
                "https://org2-market.fly.dev/w/{}",
                selection.metadata.workspace_id
            ),
        })
    }
    fn credential<'a>(
        &'a self,
        key: &'a str,
        agent: &'a str,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Credential, String>> + Send + 'a>>
    {
        let owner = Arc::clone(&self.state);
        let key = key.to_owned();
        let agent = agent.to_owned();
        Box::pin(async move {
            tokio::spawn(async move {
                let key = key.as_str();
                let agent = agent.as_str();
                let selection = Selection::parse(key, agent)?;
                let mut state = owner.lock().await;
                let owner_key = serde_json::to_string(&selection.metadata)
                    .map_err(|_| "Invalid Market identity")?;
                if !state.connections.contains_key(&owner_key) {
                    if state.connections.len() >= 32 {
                        return Err("Market connection limit reached".into());
                    }
                    let metadata = selection.metadata.clone();
                    if !tokio::task::spawn_blocking(move || {
                        super::enabled::read_index().map(|r| r.contains(&metadata))
                    })
                    .await
                    .map_err(|_| "Market index unavailable")??
                    {
                        return Err("Market authorization is missing".into());
                    }
                    let scope = app_paths::orgii_root().to_string_lossy().into_owned();
                    let connection = Connection::restore(scope, selection.metadata.clone()).await?;
                    state.connections.insert(owner_key.clone(), connection);
                }
                let now = chrono::Utc::now().timestamp_millis();
                if !state
                    .credentials
                    .get(key)
                    .is_some_and(|c| c.expires_at() > now + 60000)
                {
                    if !state.credentials.contains_key(key) && state.credentials.len() >= 32 {
                        return Err("Market selection limit reached".into());
                    }
                    let connection = state
                        .connections
                        .get(&owner_key)
                        .ok_or("Market connection missing")?;
                    let wire_agent = if agent == "codex" { "codex" } else { "claude" };
                    let credential = connection
                        .workspace_credential(&selection.entitlement_id, wire_agent)
                        .await?;
                    state.credentials.insert(key.into(), credential);
                }
                let credential = state
                    .credentials
                    .get(key)
                    .ok_or("Market credential missing")?;
                Ok(Credential {
                    destination: Destination {
                        provider: "market".into(),
                        authentication: Authentication::Bearer,
                        base_url: credential.base_url().into(),
                    },
                    secret: credential.bearer().into(),
                })
            })
            .await
            .map_err(|_| "Market credential task failed".to_string())?
        })
    }
}

static INSTANCE: std::sync::OnceLock<Arc<MarketSource>> = std::sync::OnceLock::new();
pub(super) fn instance() -> Arc<MarketSource> {
    Arc::clone(INSTANCE.get_or_init(|| Arc::new(MarketSource::default())))
}
pub(super) async fn retire_for_reauthorization() -> tokio::sync::OwnedMutexGuard<State> {
    let source = instance();
    let mut state = Arc::clone(&source.state).lock_owned().await;
    state.credentials.clear();
    state.connections.clear();
    state
}

#[cfg(test)]
mod tests {
    use super::*;
    fn selection() -> Selection {
        Selection {
            metadata: ConnectionMetadata {
                identity_user_id: "11111111-1111-4111-8111-111111111111".into(),
                workspace_id: "ws_fixture".into(),
                target: market_connect::Target::Codex,
            },
            entitlement_id: "ent_fixture".into(),
        }
    }
    #[test]
    fn managed_selection_is_metadata_only_and_agent_bound() {
        let key = selection().key().unwrap();
        assert_eq!(
            Selection::parse(&key, "codex")
                .unwrap()
                .metadata
                .workspace_id,
            "ws_fixture"
        );
        assert!(Selection::parse(&key, "claude_code").is_err());
        let raw = URL_SAFE_NO_PAD
            .decode(key.strip_prefix("market:").unwrap())
            .unwrap();
        let value: serde_json::Value = serde_json::from_slice(&raw).unwrap();
        assert_eq!(value.as_object().unwrap().len(), 2);
        assert!(value.get("token").is_none());
    }
    #[test]
    fn selected_entitlement_cannot_be_an_arbitrary_path() {
        let mut selection = selection();
        selection.entitlement_id = "../../identity/logout".into();
        assert!(Selection::parse(&selection.key().unwrap(), "codex").is_err());
        assert!(Selection::parse(&"market:x".repeat(1025), "codex").is_err());
    }
    #[tokio::test]
    async fn reauthorization_holds_source_until_new_store_commit() {
        let guard = retire_for_reauthorization().await;
        let source = instance();
        assert!(source.state.try_lock().is_err());
        assert!(guard.connections.is_empty());
        assert!(guard.credentials.is_empty());
        drop(guard);
        assert!(source.state.try_lock().is_ok());
    }
}

pub(super) async fn options(
    metadata: ConnectionMetadata,
) -> Result<Vec<market_connect::WorkspaceEntitlement>, String> {
    let source = instance();
    tokio::spawn(async move {
        let mut state = source.state.lock().await;
        let key = serde_json::to_string(&metadata).map_err(|_| "Invalid Market identity")?;
        if !state.connections.contains_key(&key) {
            if state.connections.len() >= 32 {
                return Err("Market connection limit reached".into());
            }
            let expected = metadata.clone();
            if !tokio::task::spawn_blocking(move || {
                super::enabled::read_index().map(|r| r.contains(&expected))
            })
            .await
            .map_err(|_| "Market index unavailable")??
            {
                return Err("Market authorization is missing".into());
            }
            let scope = app_paths::orgii_root().to_string_lossy().into_owned();
            state
                .connections
                .insert(key.clone(), Connection::restore(scope, metadata).await?);
        }
        state
            .connections
            .get(&key)
            .ok_or("Market connection missing")?
            .entitlements()
            .await
            .map_err(Into::into)
    })
    .await
    .map_err(|_| "Market workspace request failed")?
}
