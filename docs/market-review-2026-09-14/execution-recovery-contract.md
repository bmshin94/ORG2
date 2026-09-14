# Market execution recovery: verified boundaries and implementation contract

Source inspected: ORG2 `6764b26e97579e037be938df374ec9979328f99e`.
This is an implementation contract derived from the actual execution paths, not passing acceptance evidence.

## Current behavior confirmed from source

1. `MarketConnect/launch.ts` creates a normal TUI Session and then calls `cli_config_prepare_launch`. The selected model is now in the Session create payload. The selected dynamic credential identity is still only supplied to profile preparation.
2. `agent-cli/managed_config/launch.rs` snapshots the current global managed proxy URL/token into a separate native home. Release removes only owned config files, preserving history. This preserves the initial routing generation but does not create an independently resolvable session credential source.
3. `cli_managed_proxy::proxy_agent_handler` asks ContextResolver for the agent's current selection before checking the supplied token. Its production resolver reads `managed_selection_for_agent(agent_name)`. Switching that global selection invalidates an older launch token. The existing behavior intentionally fails rather than rebinding an old terminal, but cannot independently restore multiple workspaces.
4. `dynamic_credentials::Source` already separates destination from asynchronous credential resolution. Market's implementation rotates grants and caches per identity/workspace/target. This is the reusable credential boundary; KeyVault provider-specific OAuth refresh and the old hosted-key allocation path are different contracts.
5. The normal CLI runner resolves `CodeSession.account_id` through KeyVault, including provider-specific freshness calls before building the environment. It cannot currently interpret a Market dynamic selection. A string-prefix insertion alone would not implement execution recovery.
6. Desktop imported-history continuation uses the canonical timeline and selected target to discover/materialize native execution. It does not simply execute CliResumePlan.resumeArgs. Therefore missing original CODEX_HOME in that adapter alone is not proof that canonical continuation loses context.
7. Mobile imported Codex sends and the orgtrack direct-resume command do use the original native ID, with args and cwd but no recorded custom home. Those direct-resume paths require separate home and credential ownership handling; they must not be conflated with canonical materialization.

## Required implementation invariants

- A durable Session owns its credential-source identity, selected model and native execution identity. Persist no provider secret or rotating grant in this record. Choose an explicit source contract; do not silently reinterpret KeyVault-only account IDs or hosted-key billing.
- A running session's local proxy token resolves that session's selected source, independently of the global settings selection. Authentication must reject unknown/stale tokens before contacting a provider. Resource ownership must bound live entries and release them on every terminal path.
- Every upstream request uses the registered source's credential resolution so refresh remains native and does not require user config replacement. Module removal, disconnect or revoked entitlement must fail without selecting another account.
- Restart reconstructs routing from durable non-secret identity and current authorization. It does not reuse a stale local proxy token from a deleted configuration.
- Explicit account/workspace switching starts or reuses an execution episode only under the matching source identity. Canonical history reuse must compare that identity as well as runtime/workspace.
- Direct native resume locates the original home. Canonical continuation may materialize a new native episode, but must preserve the logical timeline and selected billing source. These are different valid mechanisms with different acceptance assertions.

## Acceptance matrix still required

| Scenario                         | Authoritative evidence required                                                                             |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Initial launch                   | Session persistence contains model/source identity; real request reaches the selected workspace and receipt |
| Close and restart                | Native history still readable; restored request charged to the same selected source                         |
| Two workspaces using one client  | Switching global settings does not rebind or break the other session; distinct receipts                     |
| Credential rotation during use   | Later requests resolve renewed credentials without config replacement or repeated login                     |
| Local disconnect / remote revoke | Further requests fail through that source; no default-account fallback; local recovery remains available    |
| Module unavailable               | Persisted source is reported unavailable before launch or credential consumption                            |
| Direct native resume             | Original native UUID found under the correct home and explicit source selected                              |
| Canonical continuation           | Complete timeline materialized/reused under a matching durable source identity                              |
| Crash and repeated open/close    | No secret-bearing orphan token, uncontrolled registry growth, or transcript deletion                        |

No item in this matrix is marked passed by source inspection or by the model-persistence patch. No production state or credentials were changed during this audit.
