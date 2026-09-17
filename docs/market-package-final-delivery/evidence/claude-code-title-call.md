# Extra small Market request after external Claude Code calls = automatic title call

Observed 2026-09-17 during acceptance: two foreground `/model` calls produced
three settled Market requests; the third (2306 µUSD buyer) had no obvious origin.

Reproduction (2026-09-17 ~21:20Z, local acceptance Market, default `~/.claude`
home untouched, `claude -p --settings <overlay> --model <beginner alias>`):

- Session transcript contains exactly one `ai-title` record.
- Ledger shows two new requests: foreground `Coding for beginner` (buyer 47127 /
  seller 36654 / platform 10473 µUSD) and `[Acceptance] Sonnet overlap` (buyer
  2263 / seller 1760 / platform 503 µUSD), both `completed`, verified, reserve 0.
- The overlay pinned `ANTHROPIC_DEFAULT_HAIKU_MODEL` to the overlap alias, so
  the title call went to that Package even though the foreground used beginner.

Conclusion: the extra request is Claude Code's title generation on the haiku
role. Attribution follows the connection's default Package (the pinned role
aliases), not the Package chosen with `/model`. Auxiliary calls cannot be
correlated to the foreground conversation at the proxy (Claude Code uses a
different `metadata` session identity for them), so per-session routing is not
available; see tracking row 2 for the decision.
