# AppConnectionPage UI audit

| Line                        | Element                     | Verdict          | Reason                                                                                                                      | Suggested change                                                                       |
| --------------------------- | --------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `ConnectionCards.tsx:40`    | Multi-line selectable cards | fix              | Standard fixed button height caused overlapping labels in the actual app                                                    | Applied compound custom layout and automatic height in the existing reusable component |
| `AppConnectionPage.tsx:342` | Market choices              | fix              | Duplicated connection-card implementation diverged from the existing editor                                                 | Reused ConnectionCards with entitlement identity and title                             |
| `AppConnectionPage.tsx:389` | Account configuration       | fix              | A displayed account choice only opened another screen without carrying its selection                                        | Render the existing ClaudeProfileEditor or HarnessConnectionEditor directly            |
| `AppConnectionPage.tsx:227` | Status and actions          | keep with reason | Uses SectionContainer, SectionRow and shared Button; conflict and installation status remain distinct                       | None                                                                                   |
| `AppConnectionPage.tsx:308` | Provider navigation cards   | keep with reason | Reuses ConnectionCards rather than a separate local card helper; no raw buttons or substitute clickable elements introduced | None                                                                                   |

Verdict totals: **3 fix**, **2 keep with reason**, **0 abstract**.

Source audit is not visual acceptance. Earlier report incorrectly accepted the fixed-height cards; the user's screenshot demonstrated the missed layout failure. Native rebuild and screenshot verification are tracked separately.
