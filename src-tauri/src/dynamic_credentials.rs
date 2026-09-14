//! Generic native credential sources for managed clients. Registration belongs
//! to application composition; providers may rotate secrets without config edits.
use std::{
    future::Future,
    pin::Pin,
    sync::{Arc, OnceLock, RwLock},
};

/// Authentication is declared by the source, independent of its namespace.
#[derive(Debug, Clone, Copy)]
pub enum Authentication {
    ProtocolDefault,
    Bearer,
}

#[derive(Clone)]
pub struct Destination {
    pub authentication: Authentication,
    pub provider: String,
    pub base_url: String,
}
pub struct Credential {
    pub destination: Destination,
    pub secret: String,
}
pub trait Source: Send + Sync {
    fn namespace(&self) -> &'static str;
    fn destination(&self, selection: &str, agent: &str) -> Result<Destination, String>;
    /// Optional stateless MCP endpoint, using this source's refreshed credential.
    fn mcp_endpoint(&self, _selection: &str, _agent: &str) -> Result<Option<String>, String> {
        Ok(None)
    }
    fn credential<'a>(
        &'a self,
        selection: &'a str,
        agent: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Credential, String>> + Send + 'a>>;
}
static SOURCES: OnceLock<RwLock<Vec<Arc<dyn Source>>>> = OnceLock::new();
pub fn register(source: Arc<dyn Source>) -> Result<(), String> {
    let namespace = source.namespace();
    if namespace.is_empty()
        || !namespace
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c == b'-')
    {
        return Err("Invalid credential namespace".into());
    }
    let mut sources = SOURCES
        .get_or_init(Default::default)
        .write()
        .map_err(|_| "Credential sources unavailable")?;
    if sources.len() >= 8 || sources.iter().any(|s| s.namespace() == namespace) {
        return Err("Duplicate or excessive credential sources".into());
    }
    sources.push(source);
    Ok(())
}
pub fn source(selection: &str) -> Result<Option<Arc<dyn Source>>, String> {
    // Static KeyVault IDs have no source prefix. Unknown prefixed selections
    // fail closed, including selections left by a disabled optional module.
    let Some((namespace, _)) = selection.split_once(':') else {
        return Ok(None);
    };
    let sources = SOURCES
        .get_or_init(Default::default)
        .read()
        .map_err(|_| "Credential sources unavailable")?;
    sources
        .iter()
        .find(|s| s.namespace() == namespace)
        .cloned()
        .map(Some)
        .ok_or_else(|| "Selected credential module is unavailable".into())
}
