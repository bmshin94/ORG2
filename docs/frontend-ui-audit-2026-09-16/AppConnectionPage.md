# AppConnectionPage UI audit

| Line                               | Element                              | Verdict          | Reason                                                                                                                                    | Suggested change |
| ---------------------------------- | ------------------------------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `HarnessConnectionsSection.tsx:54` | Target application selector          | keep with reason | Reuses the shared `SegmentedTextPill` control and keeps the three application targets in one predictable location.                        | None.            |
| `AppConnectionPage.tsx:210`        | Current connection panel             | keep with reason | Reuses `SectionContainer`, `SectionRow`, and shared typography classes; it is the single ordinary-user status surface for every target.   | None.            |
| `AppConnectionPage.tsx:231`        | Select, launch, and restore actions  | keep with reason | All actions use the shared `Button` component with semantic loading and disabled states.                                                  | None.            |
| `AppConnectionPage.tsx:331`        | Market connection choice card        | keep with reason | Uses the shared `Button` with caller-owned compound card layout; the custom height and padding are needed for a two-line selectable item. | None.            |
| `AppConnectionPage.tsx:384`        | Provider and connection choice cards | keep with reason | The repeated two-line presentation is centralized in local `ConnectionChoiceButton` while retaining the shared `Button` primitive.        | None.            |

Verdict totals: **0 fix**, **5 keep with reason**, **0 abstract**.
