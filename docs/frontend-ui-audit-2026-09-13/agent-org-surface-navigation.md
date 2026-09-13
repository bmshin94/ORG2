# Agent Org surface navigation UI audit

| Line                                                                                  | Element                         | Verdict          | Reason                                                                                                                         | Suggested change |
| ------------------------------------------------------------------------------------- | ------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `src/engines/ChatPanel/ChatHistory/components/AgentOrgSurfaceSwitcher.tsx:134`        | Team Overview control           | keep with reason | Uses the shared `Button` soft appearance, semantic `aria-pressed` selected state, and the requested shared hierarchy icon      | None             |
| `src/engines/ChatPanel/ChatHistory/components/AgentOrgSurfaceSwitcher.tsx:165`        | Surface selector trigger        | keep with reason | Uses the shared `Button`, dropdown engine, spacing tokens, keyboard semantics, and truncation for constrained widths           | None             |
| `src/engines/ChatPanel/ChatHistory/components/AgentOrgSurfaceSwitcher.tsx:216`        | Group and member dropdown rows  | keep with reason | Native menu-item buttons preserve the feature-specific check/status/badge three-column layout inside the shared dropdown panel | None             |
| `src/engines/ChatPanel/ChatHistory/components/AgentOrgOverviewTray.tsx:13`            | Overview tray shell             | keep with reason | The 45% height is an explicit product constraint; width, panel surface, border, radius and shadow reuse existing shared tokens | None             |
| `src/engines/ChatPanel/ChatHistory/GroupChatView/AgentOrgGroupProjectionView.tsx:123` | Group chat navigation and width | keep with reason | Reuses the same switcher, overview tray and 800px conversation-width token as Coordinator and Member surfaces                  | None             |

Verdict totals: **0 fix**, **5 keep with reason**, **0 abstract**.
