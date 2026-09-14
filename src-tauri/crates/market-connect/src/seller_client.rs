//! Short-lived seller enrollment credential. Never persisted or sent over IPC.
use crate::{
    client::{bounded_response, valid_identity},
    SellerRedemption, CONSOLE,
};
use serde::Deserialize;
use std::time::Duration;
const MARKET: &str = "https://org2-market.fly.dev:8443";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireGrant {
    token: String,
    identity_user_id: String,
    session_version: u64,
    connection_id: String,
    provider: String,
    region: String,
    state: String,
    expires_at: String,
    market_url: String,
}
// No Debug/Serialize implementation: callers see only public enrollment metadata.
pub struct SellerConnection {
    grant: WireGrant,
    expires_at: i64,
}
impl SellerConnection {
    pub fn identity_user_id(&self) -> &str {
        &self.grant.identity_user_id
    }
    pub fn connection_id(&self) -> &str {
        &self.grant.connection_id
    }
    pub fn provider(&self) -> &str {
        &self.grant.provider
    }
    pub fn region(&self) -> &str {
        &self.grant.region
    }
    pub fn attempt_id(&self) -> &str {
        &self.grant.state
    }
    pub fn expired(&self) -> bool {
        chrono::Utc::now().timestamp_millis() >= self.expires_at
    }
    /// Only for native fixed-destination requests, never UI configuration.
    pub fn bearer(&self) -> Result<&str, &'static str> {
        if self.expired() {
            Err("seller_connection_expired")
        } else {
            Ok(&self.grant.token)
        }
    }
    fn parse(raw: &[u8], redemption: &SellerRedemption) -> Result<Self, &'static str> {
        if raw.len() > 16384 {
            return Err("invalid_seller_grant");
        }
        let g: WireGrant = serde_json::from_slice(raw).map_err(|_| "invalid_seller_grant")?;
        let expires_at = chrono::DateTime::parse_from_rfc3339(&g.expires_at)
            .map_err(|_| "invalid_seller_grant")?
            .timestamp_millis();
        let now = chrono::Utc::now().timestamp_millis();
        let token = g
            .token
            .strip_prefix("og2sn_")
            .ok_or("invalid_seller_grant")?;
        let connection = g
            .connection_id
            .strip_prefix("seller_native_")
            .ok_or("invalid_seller_grant")?;
        if !crate::nonce(token)
            || !valid_identity(&g.identity_user_id)
            || g.session_version > 9_007_199_254_740_991
            || connection.len() != 32
            || !connection
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
            || g.market_url != MARKET
            || g.provider != redemption.selection.provider
            || g.region != redemption.selection.region
            || g.state != redemption.attempt_id()
            || expires_at <= now
            || expires_at > now + 301_000
        {
            return Err("invalid_seller_grant");
        }
        Ok(Self {
            grant: g,
            expires_at,
        })
    }
}
impl SellerRedemption {
    pub async fn exchange(self) -> Result<SellerConnection, &'static str> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(8))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| "seller_transport_unavailable")?;
        let response = client
            .post(format!("{CONSOLE}/api/auth/native/seller/exchange"))
            .json(&self.proof)
            .send()
            .await
            .map_err(|_| "seller_exchange_failed")?;
        let raw = bounded_response(response)
            .await
            .map_err(|_| "seller_exchange_failed")?;
        SellerConnection::parse(&raw, &self)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::{SellerEnrollment, SellerSelection};
    fn fixture() -> (SellerRedemption, serde_json::Value) {
        let mut flow = SellerEnrollment::default();
        let url = url::Url::parse(
            &flow
                .begin(SellerSelection {
                    provider: "claude".into(),
                    region: "sjc".into(),
                })
                .unwrap(),
        )
        .unwrap();
        let state = url
            .query_pairs()
            .find(|(k, _)| k == "state")
            .unwrap()
            .1
            .to_string();
        let proof = flow
            .take_redemption(&format!(
                "orgii://market/seller/authorized?state={state}&code={}",
                "a".repeat(43)
            ))
            .unwrap();
        let value = serde_json::json!({"token":format!("og2sn_{}","b".repeat(43)),"identity_user_id":"11111111-1111-4111-8111-111111111111","session_version":0,"connection_id":format!("seller_native_{}","c".repeat(32)),"provider":"claude","region":"sjc","state":state,"expires_at":(chrono::Utc::now()+chrono::Duration::minutes(5)).to_rfc3339(),"market_url":MARKET});
        (proof, value)
    }
    #[test]
    fn accepts_exact_approved_context_and_expires_without_refresh() {
        let (proof, value) = fixture();
        let mut grant =
            SellerConnection::parse(&serde_json::to_vec(&value).unwrap(), &proof).unwrap();
        assert_eq!(grant.provider(), "claude");
        assert_eq!(grant.region(), "sjc");
        assert!(grant.bearer().is_ok());
        grant.expires_at = chrono::Utc::now().timestamp_millis() - 1;
        assert!(grant.bearer().is_err());
    }
    #[test]
    fn rejects_substitution_or_general_login_credentials() {
        for (key, value) in [
            ("provider", "codex"),
            ("region", "fra"),
            ("market_url", "https://attacker.invalid"),
            ("token", "og2r_not_a_seller_grant"),
            ("refresh_token", "not_allowed"),
            ("state", "wrong"),
            ("identity_user_id", "not-a-user"),
        ] {
            let (proof, mut body) = fixture();
            body[key] = value.into();
            assert!(SellerConnection::parse(&serde_json::to_vec(&body).unwrap(), &proof).is_err());
        }
    }
    #[test]
    fn rejects_lifetime_expansion_and_expired_response() {
        for seconds in [-1, 3600] {
            let (proof, mut body) = fixture();
            body["expires_at"] = (chrono::Utc::now() + chrono::Duration::seconds(seconds))
                .to_rfc3339()
                .into();
            assert!(SellerConnection::parse(&serde_json::to_vec(&body).unwrap(), &proof).is_err());
        }
    }
}
