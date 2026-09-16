# Market App Connections architecture audit

## Completion criteria

- One ordinary App Connections flow for Claude Code, Claude Desktop, and Codex.
- Each Market entitlement remains an independent buyer-safe Connection.
- The applied application configuration, rather than recent UI history, identifies the current Market Connection.
- Provider Profile v1 remains readable and unchanged.
- Restore remains application-scoped and preserves purchases and saved profiles.

## Ten-layer review

| Layer                        | Coverage                                                                                                                             | Verdict                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| 1. Compilation               | TypeScript typecheck, focused Vitest, Rust managed-config and Market tests                                                           | Passed.                                                                                  |
| 2. Dead code and duplication | Removed the parallel top-level Market service surface and duplicate credential importer; ordinary targets share `AppConnectionPage`  | No second user-facing connection flow remains.                                           |
| 3. Naming                    | Renamed the ordinary component from `MarketNativeAppConnections` to `AppConnectionPage`; Market remains a connection source          | Internal names match product concepts.                                                   |
| 4. Semantic overloading      | `ConnectionSourceRef` distinguishes Key Vault and Market; Profile v1 remains an advanced app configuration                           | Connection and Profile are no longer presented as synonyms.                              |
| 5. Default branches          | Target-to-agent mapping explicitly treats Claude Desktop as Anthropic ingress and Codex separately                                   | Current three target variants are covered; adding a target requires extending the union. |
| 6. Cross-domain leakage      | Market selection parsing is isolated in `marketSelection.ts`; UI receives metadata only                                              | No seller identity or seller credential crosses into settings UI.                        |
| 7. New-developer clarity     | Ordinary flow is target → provider → connection; advanced editors remain behind Advanced                                             | The primary call chain is visible without knowledge of manifests or routing.             |
| 8. Wire and serialization    | Existing Market selection contains only connection metadata and entitlement identifiers; provider Profile v1 is unchanged            | No new credential field or persisted wire migration.                                     |
| 9. Initialization parity     | Every target uses the same status hook and refresh invalidation; Market profiles share one cached loader                             | Claude Code, Claude Desktop, and Codex enter through the same UI lifecycle.              |
| 10. Resolver symmetry        | Applied Market Connection resolves from the managed manifest selection; compatible options resolve from the same entitlement catalog | Reload and same-title purchases preserve the selected entitlement.                       |

## Remaining boundary

Key Vault account configuration still delegates to the existing advanced provider/profile editor because its target-specific endpoint, authentication, test receipt, and model-role mapping cannot yet be represented by the simple Market default-profile path. Market does not mutate that persisted v1 contract.
