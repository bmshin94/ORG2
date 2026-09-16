# Market native app connections UI audit

| Line                                 | Element                     | Verdict          | Reason                                                                                                                                                                 | Suggested change |
| ------------------------------------ | --------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `MarketNativeAppConnections.tsx:103` | Native-app status row       | keep with reason | Reuses `SectionRow` for the established settings label, description, and action alignment                                                                              | None             |
| `MarketNativeAppConnections.tsx:111` | Connect action              | keep with reason | Reuses the shared `Button` primary action with native loading and disabled states                                                                                      | None             |
| `MarketNativeAppConnections.tsx:138` | Open and disconnect actions | keep with reason | Reuses shared `Button` variants and keeps the destructive-looking restore action visually secondary because it preserves purchases and only restores app configuration | None             |
| `MarketNativeAppConnections.tsx:217` | Workspace and app cards     | keep with reason | Reuses `SectionContainer` and `SectionRow`; no parallel card shell or arbitrary color was introduced                                                                   | None             |
| `HarnessConnectionsSection.tsx:53`   | Advanced provider settings  | keep with reason | Reuses the design system's collapsible `SectionContainer`, keeping credential migration and provider editing out of the daily Market path                              | None             |

Verdict totals: **0 fix**, **5 keep with reason**, **0 abstract**.
