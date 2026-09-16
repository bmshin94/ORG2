# Market workspace bridge architecture audit

## Completion criteria

- A Market purchase is exposed as an ORG2 execution source, not as a Key Vault
  account or provider profile.
- Browser enrollment authorizes ORG2 once. Legacy target strings remain parseable
  only for deployed-protocol compatibility; new enrollment is canonicalized to
  `org2`.
- ORG2 sessions resolve short-lived credentials through the managed proxy.
  External applications cannot continue after ORG2 exits.
- App connections configures only an application the user explicitly connected
  to Market, follows later explicit ORG2 source changes, and restores that
  application's previous configuration on disconnect.
- Unsupported Claude Desktop formats fail closed. No alternate Claude profile
  is launched while the main application is shown to the user.
- Old profile injection, independent credential helpers, duplicate launch
  commands, filesystem workspaces, and UI-side Market error recovery are absent.

## Ten-layer audit

| Layer                        | Verdict                       | Evidence and decision                                                                                                                                                                                                                                                                                                                             |
| ---------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Compilation               | Pass                          | TypeScript fast and full typechecks, focused Vitest, Rust Market tests, `cargo check`, and `cargo clippy -D warnings` are release gates. Exact final results are recorded in PR #1846.                                                                                                                                                            |
| 2. Dead code and duplication | Pass                          | Removed Market provider-profile injection, the independent `--market-auth` helper, old apply/disconnect transactions, the parallel prepare-launch command, the isolated Claude Desktop adapter, filesystem workspace creation, and UI-side session recovery. One source picker and one managed execution-profile runner remain.                   |
| 3. Naming                    | Pass                          | `MarketExecutionProfile` is the frontend projection of a purchased workspace; `ExternalMarketTarget` names optional native clients; provider profile continues to mean the existing Key Vault/provider configuration object.                                                                                                                      |
| 4. Semantic overloading      | Pass                          | `workspace` means a Market entitlement/source, not a local directory. `App connections` means an external application adapter, not purchase discovery. `profile` is not injected into generic provider editors.                                                                                                                                   |
| 5. Defaults                  | Pass                          | New enrollment defaults explicitly to `Target::Org2`; model selection requires a model supported by the selected workspace and target family. Claude Desktop fails closed when its installed format is not verified. No fallback silently uses a personal account.                                                                                |
| 6. Domain leakage            | Pass                          | Market discovery and authorization stay in `MarketConnect`/`market-connect`; the generic proxy receives a dynamic credential source. Shared provider editors contain no Market-specific cards.                                                                                                                                                    |
| 7. New-developer clarity     | Pass                          | The product boundary and owner table live in `docs/market-desktop-module.md`. Daily workspace selection is in the existing source picker; optional app wiring is in App connections; advanced provider editing and one-time imports are collapsed.                                                                                                |
| 8. Wire protocol             | Pass with compatibility field | Stored and exchanged grants retain `target` because it participates in deployed Cloud proof validation, the keyring account hash, and existing index JSON. New enrollment sends `org2`; old target values are accepted but never broadened into canonical grants. Configure-profile IPC uses one strict request object and denies unknown fields. |
| 9. Init parity               | Pass                          | Browser deep links, existing-login discovery, recent-source selection, and explicit app connection all converge on the same canonical ORG2 grant and managed proxy. Legacy deep links are parsed at the boundary and normalized before new authorization.                                                                                         |
| 10. Resolver symmetry        | Pass                          | ORG2 and external-client paths resolve the same entitlement plus model pair. Claude targets use Claude-supported models; Codex uses Codex-supported models. Unsupported families return no selection instead of choosing the first model from another family.                                                                                     |

## Entry-point matrix

| Entry point        | Identity/grant                     | Source selection                       | Runtime route                               | External app mutation                        |
| ------------------ | ---------------------------------- | -------------------------------------- | ------------------------------------------- | -------------------------------------------- |
| Browser handoff    | Canonical ORG2 enrollment          | Refresh purchases                      | None until user starts work                 | None                                         |
| ORG2 source picker | Reuse canonical grant              | Selected purchased workspace and model | Managed execution profile                   | Sync only apps already following Market      |
| App connections    | Reuse current ORG2 workspace       | No second workspace picker             | Existing managed proxy                      | Explicit connect/open/restore for one target |
| Session resume     | Durable non-secret source metadata | Preserve original session source       | Re-resolve credential through managed proxy | None                                         |

## Compatibility boundary

Physically removing `target` from stored grants requires a versioned Cloud,
index, and keyring migration. That migration is deliberately outside this PR.
Old non-ORG2 grants remain readable and removable, but they are not treated as
all-workspace authorization and must be replaced by canonical ORG2 enrollment.
