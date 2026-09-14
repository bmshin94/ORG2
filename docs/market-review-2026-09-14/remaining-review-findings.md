# Market 外部审计复核：仍不满足发布验收

本报告合并当前状态，后面的历史记录保留测试边界，不作为重复待办。原审计针对 `4ae0a568e73ab55aec522a27963c8ba90a2283b0`；本次源代码复核针对 `3734a65d10a39f70c6afa7efba3ce2b603b89cf5`。主要修复在 `373335f36`，授权持久化补偿在 `3734a65d1`。

**结论：原审计指出的问题成立。当前已有针对性修复，但不能将这些修复或局部测试等同于可发布的一键接入。保持不合并、不宣称全流程已验收。**

## 七项发现的当前状态

| 发现                              | 当前实现及已有证据                                                                                                                                           | 仍需验证的边界                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| P1 Codex 丢失 `/v1`               | 初始 destination 和刷新凭据后的 destination 均通过协议基址函数保留 Codex `/v1`；真实本地 Router → mock upstream 测试已通过，覆盖 URI、query 和错误本地 token | 真实 Market 续期后经 Codex 发起上游请求及计量                                                    |
| P1 关闭终端删除原生历史           | 不再递归删除 home；只删除 hash 匹配的模块配置，保留其他文件；关闭后发现历史、SQLite 索引重启及原生会话 ID 回归已通过                                         | **尚未关闭整个恢复问题**：实际关闭应用、重启、继续原会话，并确认原 CODEX_HOME 与 Market 计费选择 |
| P2 断开部分成功后无法重试         | 按配置恢复 → grant 删除 → 索引写入执行；已切换到新来源时保留新配置；六个阶段前后故障场景及重复重试测试通过                                                   | 故障注入使用文件替身，尚无真实 OS Keychain 故障/进程崩溃验收                                     |
| P2 离线/过期时无法退出            | 本地配置独立于远端购买列表加载，离线、请求悬挂、无有效购买时仍可断开；渲染测试通过                                                                           | 真实桌面离线及撤销后的恢复操作                                                                   |
| P2 Linux 兑换 code 后才发现不支持 | buyer begin/complete 在兑换前检查平台能力；buyer 持久存储与 seller 临时授权分别声明，13 种语言有不可用提示                                                   | Linux 实机能力与发布包验收；不是已实现 Linux buyer 存储                                          |
| P2 Settings 删除后选择越界        | 改为身份/workspace/target 稳定选择；删除及重排渲染测试通过                                                                                                   | 真实 Settings 多连接操作                                                                         |
| P2 PowerShell 环境赋值            | RHS 始终单引号字符串并转义单引号；在 macOS PowerShell 7.6.6 实际执行生成命令，验证字面量原值                                                                 | Windows 实机路径、客户端启动及完整请求                                                           |

以上测试为此前修复阶段的已记录结果。本次仅复核当前源码、远端 PR head 和报告一致性，没有重新运行这些测试，也没有新增真实 provider 请求。

## 仍然开放的问题

1. **恢复执行链路**：`CliResumePlan` 没有原始 CODEX_HOME 字段；当前桌面 imported-history adapter 只取 cwd 进入通用 continuation。保留文件和索引不能证明最终执行恢复原会话或沿用 Market 计费。需要继续追踪执行边界并完成真实恢复。
2. **跨工作区阻塞**：`MarketSource` 的全局 mutex 仍跨索引读取、Keychain 恢复及 HTTP 请求持有。需要按连接身份划分同步范围，同时保持续期单次消费及断开/重新授权的互斥安全；目前未修复、未测量。
3. **断开与撤销**：当前桌面断开只恢复配置、清理本地凭据和索引，不包含服务端撤销。不能把本地断开描述为服务端授权已撤销。
4. **模块移除与残留目录**：module-off 编译和目录数量限制不能证明运行时配置恢复或崩溃残留处理。不得为清理目录再次删除原生会话数据。
5. **授权持久化**：已改为先写非秘密索引、再保存凭据，避免新 grant 无法发现；缺少真实 Keychain 故障与崩溃测试，也没有自动恢复历史孤立 grant。
6. **跨仓库及发布**：seller complete/cancel 竞态、重复绑定、过期边界，以及签名主应用 → 浏览器授权 → buyer 请求 → 计量 → 续期/撤销需要联合验收。真实 Claude App 和 Windows 尚未通过，不能用 compatibility marker 替代。

## PR 与证据范围

本次已能读取配套后端 PR 元数据，因此原审计“无法访问 #75”不再是当前取证阻碍；**能读取 PR 不代表其跨仓库契约已验收**。

- [ORG2 #1761](https://github.com/org2AI/ORG2/pull/1761)：OPEN，代码 head `3734a65d1`，base `codex/search-input-renderer-types`
- [Cloud infra #75](https://github.com/org2AI/ORGII-cloud-infra/pull/75)：OPEN，head `d05755d85d6a3b26ce189dffb86ff3d1613860ad`
- [Cloud infra #76](https://github.com/org2AI/ORGII-cloud-infra/pull/76)：OPEN，head `c9cd0fa9df861a6ac5b30ef1fbd2d2d02e2d35c1`

未合并、未由本次报告修改触发部署，也未将 CI queued/completed（无 conclusion）记为通过。以下为历史修复与测试记录，早期的 pending 以本报告上面的状态表为准。

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
