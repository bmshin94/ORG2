# Luna Reserve: why Luna calls failed and how to use the reserve — 2026-09-17

Source of truth: openai/codex at `fa8cf44` (cloned read-only).

- `codex-rs/tui/src/model_catalog.rs`: `LUNA_RESERVE_MODEL = "gpt-reserve"`. When
  ordinary usage is exhausted the official client rewrites the pending turn's
  model to this slug (`chatwidget/luna_reserve_model.rs`,
  `apply_reserve_fallback_to_pending_turn`).
- `codex-rs/backend-client/src/client/rate_limit_resets.rs`: the header
  `x-openai-codex-luna-reserve: 1` is sent only on the rate-limit status GET so
  the backend records exposure; the payload carries `ordinary_usage_allowed`.
- The reserve meter is reported as limit id `base_model_inference`, limit name
  `gpt-reserve`, `normal_model_slug: gpt-5.6-luna`, and in response headers as
  `X-Base-Model-Inference-*`.

Same account, same minute (local acceptance Market, exact-account diagnostic,
no Market state change):

| request model | upstream | headers | result |
|---|---|---|---|
| `gpt-5.6-luna` | 429 `usage_limit_reached` | `X-Codex-Primary-Used-Percent: 100`, `X-Base-Model-Inference-Primary-Used-Percent: 14` | rejected |
| `gpt-reserve` | 200 | same meters | `response.model = gpt-5.6-luna`, output `LUNA-RESERVE-OK`, 36 in / 11 out tokens |

Reports: `/tmp/market-luna-ordinary-recheck-20260917/report.json`,
`/tmp/market-luna-reserve-once-20260917/report.json`.

Consequence for the Market (cloud-infra, harness-plane Codex adapter): a Luna
request that hits `usage_limit_reached` with limit name `codex` must be retried
once with `model: "gpt-reserve"` when the account's `base_model_inference`
meter has room; the response still reports `gpt-5.6-luna`, so pricing and
receipts stay on the Luna price card. Until that lands, Codex/Luna Package
calls on an exhausted account fail even though the reserve is available.
