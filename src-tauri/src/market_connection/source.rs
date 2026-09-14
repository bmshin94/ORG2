use crate::dynamic_credentials::{Authentication, Credential, Destination, Source};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use market_connect::{Connection, ConnectionMetadata, WorkspaceCredential};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

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
/// Configuration ownership is connection-scoped, even when the purchased listing changed.
pub(super) fn belongs_to(
    key: &str,
    agent: &str,
    metadata: &ConnectionMetadata,
) -> Result<bool, String> {
    if !key.starts_with("market:") {
        return Ok(false);
    }
    Ok(Selection::parse(key, agent)?.metadata == *metadata)
}

#[derive(Default)]
struct ConnectionState {
    connection: Option<Arc<Connection>>,
    credentials: HashMap<String, WorkspaceCredential>,
}
#[derive(Default)]
struct State {
    connections: HashMap<String, Arc<tokio::sync::Mutex<ConnectionState>>>,
    selections: HashSet<String>,
}
#[derive(Clone, Default)]
pub(super) struct MarketSource {
    state: Arc<tokio::sync::Mutex<State>>,
    // Requests share this barrier. Authorization mutations take it exclusively,
    // wait for prior requests, and keep it until the persistent commit finishes.
    authorization: Arc<tokio::sync::RwLock<()>>,
}
impl MarketSource {
    async fn acquire(
        &self,
        metadata: &ConnectionMetadata,
        selection: Option<&str>,
    ) -> Result<
        (
            tokio::sync::OwnedRwLockReadGuard<()>,
            Arc<tokio::sync::Mutex<ConnectionState>>,
        ),
        String,
    > {
        let authorization = Arc::clone(&self.authorization).read_owned().await;
        let key = serde_json::to_string(metadata).map_err(|_| "Invalid Market identity")?;
        let mut state = self.state.lock().await;
        if !state.connections.contains_key(&key) && state.connections.len() >= 32 {
            return Err("Market connection limit reached".into());
        }
        if let Some(selection) = selection {
            if !state.selections.contains(selection) && state.selections.len() >= 32 {
                return Err("Market selection limit reached".into());
            }
            state.selections.insert(selection.into());
        }
        let connection = Arc::clone(state.connections.entry(key).or_default());
        Ok((authorization, connection))
    }

    async fn retire(&self) -> tokio::sync::OwnedRwLockWriteGuard<()> {
        let guard = Arc::clone(&self.authorization).write_owned().await;
        *self.state.lock().await = State::default();
        guard
    }
}
impl ConnectionState {
    async fn restore(&mut self, metadata: ConnectionMetadata) -> Result<Arc<Connection>, String> {
        if let Some(connection) = &self.connection {
            return Ok(Arc::clone(connection));
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
        let connection = Connection::restore(scope, metadata).await?;
        self.connection = Some(Arc::clone(&connection));
        Ok(connection)
    }
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
            base_url: protocol_base_url(
                &format!(
                    "https://org2-market.fly.dev/w/{}",
                    selection.metadata.workspace_id
                ),
                agent,
            ),
        })
    }
    fn credential<'a>(
        &'a self,
        key: &'a str,
        agent: &'a str,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Credential, String>> + Send + 'a>>
    {
        let owner = self.clone();
        let key = key.to_owned();
        let agent = agent.to_owned();
        Box::pin(async move {
            tokio::spawn(async move {
                let key = key.as_str();
                let agent = agent.as_str();
                let selection = Selection::parse(key, agent)?;
                let (_authorization, entry) = owner.acquire(&selection.metadata, Some(key)).await?;
                let mut state = entry.lock().await;
                let connection = state.restore(selection.metadata.clone()).await?;
                let now = chrono::Utc::now().timestamp_millis();
                if state
                    .credentials
                    .get(key)
                    .is_none_or(|c| c.expires_at() <= now + 60000)
                {
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
                        base_url: protocol_base_url(credential.base_url(), agent),
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
pub(super) async fn retire_for_reauthorization() -> tokio::sync::OwnedRwLockWriteGuard<()> {
    instance().retire().await
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
    fn disconnect_matches_connection_identity_not_purchase_or_other_accounts() {
        let original = selection();
        let mut next = selection();
        next.entitlement_id = "ent_other_listing".into();
        assert!(belongs_to(&next.key().unwrap(), "codex", &original.metadata).unwrap());
        assert!(!belongs_to("ordinary-account", "codex", &original.metadata).unwrap());
        next.metadata.workspace_id = "ws_other".into();
        assert!(!belongs_to(&next.key().unwrap(), "codex", &original.metadata).unwrap());
        next.metadata = original.metadata.clone();
        next.metadata.identity_user_id = "22222222-2222-4222-8222-222222222222".into();
        assert!(!belongs_to(&next.key().unwrap(), "codex", &original.metadata).unwrap());
        assert!(belongs_to("market:invalid", "codex", &original.metadata).is_err());
        assert!(belongs_to(&original.key().unwrap(), "claude_code", &original.metadata).is_err());
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
        let source = MarketSource::default();
        let guard = source.retire().await;
        assert!(source.authorization.try_read().is_err());
        assert!(source.state.lock().await.connections.is_empty());
        assert!(source.state.lock().await.selections.is_empty());
        drop(guard);
        assert!(source.authorization.try_read().is_ok());
    }
    #[tokio::test]
    async fn slow_connection_does_not_block_another_workspace_and_same_owner_serializes() {
        let source = MarketSource::default();
        let first = selection();
        let (_active, entry) = source
            .acquire(&first.metadata, Some("first"))
            .await
            .unwrap();
        let _slow_operation = entry.lock().await;
        let mut other = first.metadata.clone();
        other.workspace_id = "ws_other".into();
        let (_other_active, other_entry) = tokio::time::timeout(
            std::time::Duration::from_secs(1),
            source.acquire(&other, Some("other")),
        )
        .await
        .unwrap()
        .unwrap();
        assert!(other_entry.try_lock().is_ok());
        let (_same_active, same_entry) = source
            .acquire(&first.metadata, Some("second_model"))
            .await
            .unwrap();
        assert!(Arc::ptr_eq(&entry, &same_entry));
        assert!(same_entry.try_lock().is_err());
        // Registry access stays short even while an owner performs I/O.
        assert!(source.state.try_lock().is_ok());
    }

    #[tokio::test]
    async fn authorization_commit_waits_for_old_requests_and_discards_their_cache() {
        let source = MarketSource::default();
        let metadata = selection().metadata;
        let (active, old_entry) = source.acquire(&metadata, Some("old")).await.unwrap();
        let retirement = source.retire();
        tokio::pin!(retirement);
        tokio::select! {
            biased;
            _ = &mut retirement => panic!("must wait for the old request"),
            _ = std::future::ready(()) => {}
        }
        // A queued writer excludes subsequent requests, avoiding starvation.
        assert!(source.authorization.try_read().is_err());
        drop(active);
        let commit = tokio::time::timeout(std::time::Duration::from_secs(1), &mut retirement)
            .await
            .unwrap();
        assert!(source.authorization.try_read().is_err());
        assert!(source.state.lock().await.connections.is_empty());
        assert!(source.state.lock().await.selections.is_empty());
        drop(commit);
        let (_new_active, new_entry) = source.acquire(&metadata, Some("new")).await.unwrap();
        assert!(!Arc::ptr_eq(&old_entry, &new_entry));
        assert!(new_entry.lock().await.connection.is_none());
    }

    #[tokio::test]
    async fn connection_and_selection_registries_stay_bounded_and_retirement_reclaims_slots() {
        let source = MarketSource::default();
        let metadata = selection().metadata;
        for index in 0..32 {
            source
                .acquire(&metadata, Some(&format!("selection_{index}")))
                .await
                .unwrap();
        }
        assert!(source.acquire(&metadata, Some("overflow")).await.is_err());
        source
            .acquire(&metadata, Some("selection_0"))
            .await
            .unwrap();
        drop(source.retire().await);
        for index in 0..32 {
            let mut owner = metadata.clone();
            owner.workspace_id = format!("ws_{index}");
            source.acquire(&owner, None).await.unwrap();
        }
        assert!(source.acquire(&metadata, None).await.is_err());
        drop(source.retire().await);
        source.acquire(&metadata, Some("new")).await.unwrap();
    }
}

pub(super) async fn options(
    metadata: ConnectionMetadata,
) -> Result<Vec<market_connect::WorkspaceEntitlement>, String> {
    let source = instance();
    tokio::spawn(async move {
        let (_authorization, entry) = source.acquire(&metadata, None).await?;
        let mut state = entry.lock().await;
        state
            .restore(metadata)
            .await?
            .entitlements()
            .await
            .map_err(Into::into)
    })
    .await
    .map_err(|_| "Market workspace request failed")?
}

// The generic Codex router strips its local /v1 prefix. Dynamic sources
// therefore supply a protocol base, rather than a workspace root.
pub(crate) fn protocol_base_url(workspace_root: &str, agent: &str) -> String {
    let root = workspace_root.trim_end_matches('/');
    if agent == "codex" {
        format!("{root}/v1")
    } else {
        root.to_owned()
    }
}
