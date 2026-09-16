# Market workspace bridge performance guard

## Runtime surface

The changed frontend work runs only after a user selects a source or presses an
App connections action. It introduces no interval, recursive timeout,
visibility listener, worker, file scan, app-lifetime cache, queue, or unbounded
registry.

When a user explicitly switches sources, the bridge reads the fixed set of
three supported external targets. It reconfigures or restores only targets that
already point at a `market:` selection. A per-picker in-flight guard rejects a
second Market selection until preparation finishes.

| Area               | Verdict | Evidence                                                                                                                   | Change or reason kept                                                             | Verification                                             |
| ------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Background work    | keep    | No timer, poller, subscription, watcher, or retry was added                                                                | Source synchronization is attached to the explicit picker action                  | Targeted bridge and picker tests; targeted source search |
| Memory             | keep    | One React ref stores an in-flight boolean; target arrays are compile-time fixed at three                                   | No retained result cache or growing collection                                    | Typecheck and unit tests                                 |
| Scope/isolation    | keep    | Target status and mutations are keyed by the concrete client target; Market grants remain scoped by identity and workspace | Only configurations whose selected key starts with `market:` are updated/restored | `externalAppBridge.test.ts`                              |
| Rendering/hot path | keep    | Status queries are owned by the App connections section; source synchronization runs after selection                       | No stream/render-loop allocation or global-store scan was introduced              | Component tests and ESLint                               |

## Lifecycle matrix

| State                     | Behavior                                                                                |
| ------------------------- | --------------------------------------------------------------------------------------- |
| App idle or hidden        | No new work                                                                             |
| Source picker open        | Purchased sources are already loaded by the picker data hook; no extra loop starts      |
| Market source selected    | One preparation request, then at most three status reads and a bounded set of updates   |
| Personal source selected  | At most three status reads; only Market-managed targets are restored                    |
| App connections unmounted | Existing connection hooks remove their listeners through their established cleanup path |
| ORG2 quits                | Managed proxy ends; no independent credential helper keeps external clients alive       |

No provider-ingestion, transcript-identity, cloud-replication, or raw-history
transition is changed by this UI bridge, so the provider/source-transition
matrix from the performance skill is not applicable here.

Performance verdict: pass
