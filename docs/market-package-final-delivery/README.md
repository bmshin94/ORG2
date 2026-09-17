# Market Package final delivery — tracking (2026-09-17)

Follow-up to ORG2 #1899 / Cloud #104 / #105 (all merged 2026-09-17). Each row
is closed only by evidence recorded under `evidence/` in this directory or by a
commit in this branch. "Blocked" rows name the external dependency.

| # | Item | Kind | Status |
|---|------|------|--------|
| 1 | Billing tail: source of the extra small request after external Claude Code calls | analysis + doc | **Closed**: it is Claude Code's automatic title call (`ai-title` record). It is billed to the Package pinned in `ANTHROPIC_DEFAULT_HAIKU_MODEL` (the connection's default), not to the Package picked with `/model`. Reproduced with a `--settings` overlay on the default `~/.claude` home: foreground → Coding for beginner 47127 µUSD, title → Sonnet overlap 2263 µUSD, both settled at Admin 45%/35%. See `evidence/claude-code-title-call.md`. |
| 2 | Auxiliary calls (title/memory/compaction) attribution | code + doc | **Closed** in this branch as explicit behaviour: they bill the connection's default Package (the pinned `ANTHROPIC_DEFAULT_*_MODEL` aliases); only the chat follows `/model`. Per-session routing is not possible because Claude Code sends auxiliary calls under a different `metadata` session identity, so the proxy cannot correlate them. App Connections (Claude Code CLI, package picker) now says so (`harnessConnections.marketApps.auxiliaryBilling`, 15 locales). |
| 3 | "Configuration changed outside ORG2" after external `/model` | code | **Closed** in this branch: Claude Code persists `/model` into the managed settings.json; status, apply and restore now treat that runtime-owned field as expected drift (`claude_code_runtime_drift_only`, mirrors the Codex `projects` and Desktop `deploymentMode` exclusions). Any other edit, including the managed `env`, still conflicts. Unit test `claude_code_model_switch_is_runtime_drift_but_other_edits_still_conflict`. |
| 4 | Claude Desktop isolation for acceptance | tooling + acceptance | Launch recipe **verified 2026-09-17**: `"/Applications/Claude.app/Contents/MacOS/Claude" --user-data-dir=<dir>` (binary, not `open`) starts an independent instance that writes only under `<dir>` (own `claude_desktop_config.json`, caches, storage) while the main app keeps running. `open -n -a Claude --env CLAUDE_USER_DATA_DIR=…` does **not** isolate: the second process opened the main data directory. Still open: point ORG2 (`ORGII_EXTERNAL_HISTORY_HOME`) at the same home, apply the Desktop connection, confirm the isolated instance reads the `Claude-3p` profile, then dual-Package selection, call, billing, restart and restore. |
| 5 | Codex full chain (ORG2 + official app, Luna/model switch, context, billing) | acceptance | **Blocked** until the Codex weekly window resets (2026-09-19 09:22Z). 2026-09-17 15:25Z direct call returned 429 `usage_limit_reached` with `X-Codex-Primary-Used-Percent: 100`; the `gpt-reserve` pool (14% used) did not substitute. |
| 6 | Login / authorization lifecycle (no saved grant, signed-out ORG2 → web enable → launch → auto sign-in → Package sync; account / Cloud URL switch; expired grant) | acceptance | Open — needs the user at the browser login step. |
| 7 | Credential renewal and supplier rotation | acceptance | Renewal: open. Rotation: **Blocked** — only one healthy Claude supplier. |
| 8 | Admin access restriction (Neonforge, Harry, Junyu Feishu open_ids) | config + acceptance | **Blocked** — same-app open_ids not provided. |
| 9 | Final-build regression: successful failed-message Retry, external CLI restart + config restore, foreground/hidden/closed resource usage | acceptance | Open — needs a private debug build of this branch. |

No ORG2 installer, Beta, release or tag is produced by this work.
