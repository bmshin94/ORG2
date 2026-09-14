# External review follow-up — request changes remains appropriate

Review target: 4ae0a568e73ab55aec522a27963c8ba90a2283b0. Work is on the existing Market review branch; no merge or release is authorized by a passing helper test.

| Finding                                                         | Current follow-up                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1 Codex /v1 missing                                            | Confirmed. Both dynamic destination paths now use a shared protocol-base adapter. Real Router → mock upstream URI regression is still required.                                                                                                                                                                   |
| P1 Native history recursively deleted                           | Confirmed. Cleanup now removes only hash-matched module-owned configuration, then attempts empty-directory removal. Older unmarked homes are retained. Two managed-launch tests passed, including transcript preservation on repeated release. Actual close/restart/history discovery and resume remain required. |
| P2 Disconnect cannot retry after partial cleanup                | Pending source fix and per-stage fault injection.                                                                                                                                                                                                                                                                 |
| P2 Offline/expired purchase hides recovery                      | Pending local-state-independent disconnect UI and rendered tests.                                                                                                                                                                                                                                                 |
| P2 Linux unsupported credential persistence discovered too late | Pending distinct buyer/seller capability advertisement and pre-exchange refusal.                                                                                                                                                                                                                                  |
| P2 Settings index becomes invalid after deletion                | Pending stable connection identity selection and list-change tests.                                                                                                                                                                                                                                               |
| P2 PowerShell assignment quoting                                | Pending always-literal environment assignment and real PowerShell execution test.                                                                                                                                                                                                                                 |

Also retain the review's concerns about global credential lock contention, remote revocation semantics, module-off recovery, Keychain/index compensation, and abandoned-home lifecycle. No closed claim yet for these. Pricing work in the companion repository is paused while these regressions are addressed.

## Recovery follow-up

- Conditional config restoration now returns the current status without changing files when a different source is selected. Repeating old-source restoration is covered by a Rust regression (1 passed); the newer manifest and config bytes remain unchanged.
- Disconnect no longer treats an already-removed index entry as a fatal precondition. Keychain removal already treats missing entries as success. Full per-stage Keychain/index fault injection is still required before closing the partial-failure finding.
- ConnectionDialog loads local configuration independently from remote purchases. Matching local metadata keeps disconnect available when remote loading rejects, never resolves, or returns no active purchases. Launch remains gated by an active compatible purchase.
- ConnectionSettings uses stable identity/workspace/target selection; refresh preserves that identity after reorder and selects the remaining item after deletion.

Verification: 8 rendered tests passed using the repository's `pnpm test` configuration across ConnectionDialog and ConnectionSettings, including the offline/pending/expired and reorder/delete cases. `tsgo --noEmit` passed. An initial direct Vitest invocation omitted the repository config and failed alias resolution; it is not passing evidence. Native disconnect per-stage failure recovery, actual UI acceptance, and the remaining review items are still open.

## PowerShell assignment follow-up

`withCliCommandEnvironment` now always emits single-quoted PowerShell string literals for environment assignment RHS values, doubling embedded single quotes. It no longer uses the command-argument safe-character shortcut.

Verification: 26 terminal command tests passed, including actual generated-command execution with official PowerShell 7.6.6 for macOS ARM64. The executable was obtained from the official PowerShell/PowerShell GitHub release into a temporary verification directory. Execution covers a space-free forward-slash Windows path, apostrophes, a `$()` expression, a variable expression and an empty string; each reaches the client body with the original literal value. `tsgo --noEmit` and diff whitespace checks passed. This verifies PowerShell parsing/execution, not a Windows desktop installation, native path access, or full Codex launch. The test runs on Windows with powershell.exe and can be enabled elsewhere with ORG2_TEST_PWSH; absence of a runtime is an explicit skip.

## Platform capability follow-up

Buyer begin and complete both check native persistent-credential availability before enrollment or code exchange. On Linux they return `market_buyer_credential_store_unavailable`; seller temporary authorization remains independently available. Module status and the versioned release marker now distinguish buyer persistent storage from seller temporary authorization. Module-off status advertises neither capability.

Verification so far: 5 release marker tests, 1 host-platform credential gate test, and TypeScript typecheck passed. The host is macOS; this is not Linux runtime acceptance. Linux execution, user-visible unavailable messaging and consumer handling of the new capability fields remain part of final acceptance.

## Router regression in progress

The production route table is now built by `proxy_router` with an injected context resolver (production uses the existing managed-config resolver). A loopback HTTP regression exercises the actual `/cli/codex/{token}/v1/{*path}` handler and `forward_request` against a mock upstream; it asserts `/w/ws_route_test/v1/responses`, query preservation and local-token rejection. Only configuration/credentials are supplied by the fixture; URI extraction and HTTP forwarding are real. This test does not perform Market token renewal or provider calls.

Native test compilation was started with `cargo test --lib codex_router_forwards_workspace_v1_uri_and_query_to_upstream` from src-tauri. Its result is pending; do not count the test as passed before inspecting the process result. The workspace credential validator was also checked: it requires the exact root `https://org2-market.fly.dev/w/{workspace}`, so adding `/v1` at the Codex protocol boundary does not duplicate a server-supplied prefix.

## Capability messaging and combined UI regression

Unsupported buyer credential storage now has a specific user-visible message in all 13 locales. The deep-link handler matches only the known capability error code and never displays raw callback/IPC data. The regression verifies that authorization is not opened and no success is reported. All 13 dictionary files parse and contain the message.

Combined Market UI and terminal regression: 59 passed, 1 skipped (the optional PowerShell executable was not supplied for this combined run; its separate real-execution run previously passed). Typecheck passed for the messaging change.

Router HTTP test first execution failed before HTTP due to missing test TLS provider initialization. The existing `test_utils::install_crypto_provider_for_tests` initializer was added and the same named test was restarted after the failed process terminated. Result pending; the initial failure is not evidence of route correctness.

Router rerun result: **1 passed, 0 failed**. The real local HTTP route delivered `/w/ws_route_test/v1/responses` (including the query case) to the mock upstream and rejected an invalid local token. This closes the route-stripping regression at the HTTP boundary; real Market credential refresh and external Codex/provider acceptance remain separate required checks.

## Disconnect fault injection

The native disconnect path now uses a shared ordered cleanup function; the intended index is serialized before effects begin. A filesystem-backed fault-injection test covers six cases: failure before or after each of configuration restoration, credential removal and index replacement. Retry plus repeated retry preserve a newer user-selected configuration and unrelated index entries while removing the old credential/index. The index effect uses the production atomic profile writer. **1 test passed covering all six cases** in the native app test binary.

Boundary: credential storage is a file-backed test double, not the operating-system Keychain, and the restore effect models the independently tested compare-before-restore contract. This proves retry orchestration under those injected failures; OS Keychain error behavior and actual desktop disconnect acceptance remain to be checked. The original P1 history issue also remains open for restart/discovery/resume even though recursive deletion has been removed.

## Native history discovery follow-up

Found an additional gap: retaining files did not make the new launch homes discoverable. Added a shared `app_paths::managed_cli_launch_root` used by the launcher and existing history scanners. Codex discovery now includes each retained home's sessions directory; Claude discovery includes projects directories and classifies their transcripts as ORG2-managed. The directory is scanned independently of any remaining temporary config/ownership marker.

Verification: the changed Codex discovery regression passed and confirms a closed launch home without temporary config is rediscovered repeatedly. Related native history suites: Codex 101 passed/3 ignored; Claude 50 passed/1 ignored. Managed launch retention 2 passed. Ignored tests were not counted as verified. These tests establish retention/discovery and guard existing parsers, but do not establish actual UI restart or `codex resume` using the correct original home. That end-to-end restoration check remains open.

## Persistent history index restart regression

Added a combination test with a valid Codex rollout in a retained launch home and a real SQLite history index. It scans, closes the database connection, reopens/scans, resolves the original native thread UUID and cwd through `cli_resume_plan_for_cached_session`, and confirms the original transcript bytes/source path survive. **1 passed**.

Remaining execution question: `CliResumePlan` carries native ID/cwd but no original CODEX_HOME. The current frontend continuation adapter consumes cwd and enters the canonical continuation machinery; no direct resumeArgs consumer was found in the scoped frontend search. Therefore this result proves persisted history/identity resolution, not that the eventual CLI execution restores the original home or preserves Market billing selection. Trace and verify the execution adapter before closing P1 history recovery.

## Authorization persistence follow-up

The authorization commit now checks the active enrollment and publishes the non-secret connection index before writing the OS credential store. Previously, an index failure after a successful credential write could leave an undiscoverable grant. A failed credential write now leaves discoverable metadata: status reports reauthorization required if no grant exists, and disconnect can remove the entry. Existing grants are retained if replacement fails before the credential write. Retired attempts cannot publish index entries. No secrets or new schema fields are added to the index. This does not recover historical orphaned grants or remotely revoke authorization.

Verification on top of integrated upstream commit `c5564be9e`: Market UI/terminal suite 60 passed including PowerShell execution on macOS; frontend typecheck passed; exact retained-history SQLite restart test 1 passed. An initial broad Rust test filter matched zero tests and is not counted as evidence. The Market native crate passes 31 tests, including before/after index and credential commit failure injection with in-memory store effects and cancelled-attempt rejection. Real Keychain failure and process-crash execution remain unverified.
