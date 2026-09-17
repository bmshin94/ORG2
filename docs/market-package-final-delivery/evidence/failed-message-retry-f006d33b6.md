# Failed-message Retry on the final build — 2026-09-17 22:21–22:27Z

Build `f006d33b6` (overlay), Instance 89, session "Reply exactly PACKAGE-FINAL-F1-CC-BEGINNER-OK…".

1. Failure injection: the local Market gateway (127.0.0.1:8937) was stopped, the
   message `Reply exactly PACKAGE-RETRY-GATE-OK. Do not use tools.` was sent from
   the ORG2 composer (foreground control). Claude Code retried the refused
   connection for 3 minutes; to obtain a terminal failure the gateway was
   restarted with a wrong signing key, after which ORG2 showed
   `API Error: 502 Failed to connect to upstream provider …` and the intent
   `00e5aa92` was recorded `failed` (22:24:47Z). No Market request, nothing charged.
2. Recovery: gateway restarted with its captured environment (correct key).
3. Retry: hover the tail failed message → pencil → **Resend** (the failed-intent
   retry path, `onFailedUserIntentRetry`). ORG2 logged
   `cli_agent_message: dispatching rerun` (22:26:46Z); the native transcript
   `ccb32190…` holds the user turn (22:26:47Z) and the assistant reply
   `PACKAGE-RETRY-GATE-OK` (22:26:52Z); root intent `0754bb45` completed.
4. Ledger: exactly one foreground request settled (`Coding for beginner`, buyer
   48278 µUSD) plus the automatic title call (382 µUSD, same package — embedded
   sessions pin every role to the session's package). Failed history kept: the
   original 412 turn, the 502 turn and the resent turn are all visible.

Observation: the open conversation view did not render the retried reply until
the session was reopened from the sidebar (the reply existed in the transcript
and DB at 22:26:52Z; the view still showed only the resent bubble at 22:28Z).
Worth a look as a UI refresh gap after Resend-retry.

Resend on a *non-tail* failed message is an edit and truncates later turns
(`useEditUserMessage`: linear hard-delete then re-submit); it was not used on the
historical 412 turn for that reason.
