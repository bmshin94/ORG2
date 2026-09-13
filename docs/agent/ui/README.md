# ORG2 UI commands

这是一条可供不同 harness 调用的语义 UI 接口。当前支持主窗口 MyStation 的 context、tabs list、精确文件打开、网页打开、Explorer / Source Control 打开和已有 tab 聚焦，以及终端打开、创建、列举、聚焦、读取、执行、输入和中断。

常用规则见 [rulebook.md](rulebook.md)。完整参数通过 `docs --list`、`docs --search`、`docs <topic>` 和 `schema <command-id>` 按需读取；这些命令在应用未启动时也可用。未发布的内部 action 不会因为使用 `exec` 而获得访问权。

## 构建和使用

在仓库根目录构建 CLI：

```sh
cargo build --manifest-path src-tauri/Cargo.toml -p org2_ui_cli --bin org2-ui
```

二进制位于 Cargo 配置的 target directory 下；不要假定本仓库的 target 目录就是实际输出位置。`cargo metadata --manifest-path src-tauri/Cargo.toml --no-deps --format-version 1` 会返回 `target_directory`。

随桌面应用打包时，现有流程会同时构建和暂存 `org2-pm`、`org2-ui`：

```sh
node scripts/tauri/prepare-sidecars.cjs --profile debug
```

重新构建并启动包含本次代码的 ORG2 后，使用 CLI 的实际可执行路径，或在其已位于 PATH 时运行：

```sh
org2-ui rulebook
org2-ui ui instances --json
org2-ui ui context --instance <instance-id> --json
org2-ui ui file open <absolute-path> --global --instance <instance-id> --reveal --json
org2-ui ui docs --search "文件"
```

桌面 binary 也支持 `org2 ui ...` / `org2 rulebook`，在进入 Tauri 前处理。Windows 请使用独立 console binary `org2-ui.exe` 以获得可靠的 stdout 和退出码。这里不修改个人 PATH、AGENTS.md 或外部 harness 配置。

CLI 与应用必须使用相同的 `ORGII_HOME`。它只连接已有的本机实例，不启动桌面应用或创建 agent session。多个实例时必须显式选择；发现最多扫描 1,024 个目录项、尝试 64 个 endpoint，每个握手最多 750ms，超过上限明确报错而不静默选择部分结果。已知 `--instance` 会直接读取该 UUID 的 descriptor。退出尽力删除自身 descriptor，异常退出的旧文件通过握手排除，CLI 不自动删除其他实例的文件。

## Harness 接入

- **ORG2 ADE Manager**：其 SOUL 从同一文件加载短 rulebook。现有 `control_orgii` 增加 `ui.capabilities`、`ui.rulebook`、`ui.docs`、`ui.receipt` 和 `uiRequest`；用法见 [native.md](native.md)。保留原有工具 authority 检查。
- **外部 Codex 或其他 shell harness**：向 agent 提供 `org2-ui` 的可执行位置，让其读取 `rulebook`。调用者不需要创建 ORG2 agent session，也不依赖 ADE Manager agent 的身份。
- **托管外部 harness**：sidecar 随应用打包；本次不新增 launcher 的专属 token、自动 rulebook 注入或 session binding，也没有验证各外部 harness 的实际启动环境。

两个执行入口汇入 `app_ui::Broker`，通过同一个文档级 Tauri Channel、Zod registry 和 workspace/tab adapter 执行。UI mutations 仍受现有 ADE Manager 开关控制；读取也需要本机凭据。此版本的 CLI 信任边界是同一 OS 用户，各 CLI harness 共享本地 caller namespace；native receipts 按调用 session 隔离。这不是每个第三方 harness 独立授权的沙箱。

## 结果边界

`applied` 表示已完成回执所述的状态修改。`--reveal` 请求切到 MyStation、目标 workspace 和 route；`presentationState: requested` / `revealed: false` 不代表已获得渲染确认。文件先检查实际 regular-file 可读性，再注册 tab；指定行号仍返回 `locationState: pending`。网页回执也不证明加载完成。

浏览器资源沿用 BrowserContext，其现有同步逻辑要求目标 workspace 已处于 presented 状态；其他 workspace 返回 `TARGET_NOT_PRESENTABLE`。文件和内置 tab 可以在明确指定的后台 workspace 注册，未传 `--reveal` 时保留当前 session / route。

请求和响应各限 64 KiB；pending 上限 50；完成回执最多 256 个、保留 60 秒。重载、卸载、取消和超时会阻止尚未开始的后续写入；已经进入 OS 的终端写入可能稍后完成，回执保留 unknown 状态。已经发生的副作用不自动回滚，跨重启也没有 exactly-once 保证。详见 [results.md](results.md) 和 [targets.md](targets.md)。

终端详细命令见 [terminals.md](terminals.md)。终端输出来自现有脱敏 PTY 缓冲区，默认尾部 4 KiB、最大 8 KiB。输入要求显式 terminal ID；最多 16 个阻塞输入 worker，单次等待最多 2 秒，超时不自动重发。shell 资源与 workspace selection 分开维护，创建仍遵守原有冷却限制。执行回执不合成退出码，也不将 Ctrl+C 等同于进程结束。

## 修改命令

公共参数与元数据的源头是 `src/ActionSystem/publicUi/catalog.ts`。修改后运行：

```sh
pnpm ui:catalog
pnpm check:ui-catalog
```

生成的 `src-tauri/crates/app-ui/catalog.json` 供 Rust catalog、CLI 参数映射、help、schema、docs 使用。前端注册和 CLI 握手校验 catalog hash。参数仍在生产 Zod handler 边界严格校验；JSON metadata 不直接授予执行权限。

短 rulebook 是有意保留的手写行为说明，限制在 800 个英文词 / 6 KiB；详细参数不在文中重复维护。增加命令时同时维护 executor、对应 adapter 和边界测试。

## 本轮交付与后续

这轮交付可执行的公共入口，同时保留 session management、回复绑定和其他 legacy GUI actions 使用的 ActionBridge。没有声称完成全量 bridge 迁移。剩余工作包括：独立窗口目标、渲染/行号完成回执、后台 workspace 的 Browser owner 抽取、每个托管 harness 的受限凭据与启动适配，以及长尾 GUI actions 的逐项公开。

架构与生命周期审查、验证命令及未验证项见 [UiCommands 审查记录](../../architecture-audit-2026-09-14/UiCommands.md)。本轮没有运行真实桌面 UI、Windows/Linux launcher、双实例呈现或 CPU/RSS 测量；单元测试和 HTTP fixture 不替代这些证据。
