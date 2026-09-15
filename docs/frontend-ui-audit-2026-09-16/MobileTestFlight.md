# Mobile TestFlight UI audit

Release-snapshot control review. TypeScript AST inspection covered the 118 changed production TS/TSX files; manually inspected the native-element results, shared Button props/presentation, session menu and tool-detail close control. This is a focused control audit, not a claim of full visual or accessibility acceptance across the feature set. Real-device VoiceOver, large text, dark theme and post-login screenshots remain unverified.

| Line                                                                                 | Element                   | Verdict          | Reason                                                                                             | Suggested change |
| ------------------------------------------------------------------------------------ | ------------------------- | ---------------- | -------------------------------------------------------------------------------------------------- | ---------------- |
| `src/modules/MobileRemote/components/composer/MobileComposerAttachmentButton.tsx:39` | Native file input         | keep with reason | Hidden browser file-picker boundary; a shared text input cannot replace file selection             | None             |
| `src/modules/MobileRemote/platform/writeClipboardText.ts:18`                         | Temporary native textarea | keep with reason | Synchronous legacy clipboard DOM boundary restores focus/selection and removes the node in finally | None             |
| `src/modules/MobileRemote/components/SessionViewMenu.tsx:35`                         | Grouping dropdown         | keep with reason | Reuses shared Dropdown and its item icon/spacing tokens; mobile CSS constrains viewport sizing     | None             |
| `src/modules/MobileRemote/components/SessionViewMenu.tsx:108`                        | Menu trigger              | keep with reason | Shared Button with iconOnly, accessible name and expanded state; touch geometry uses mobile token  | None             |
| `src/modules/MobileRemote/components/transcript/MobileToolDetailModal.tsx:91`        | Close action              | keep with reason | Shared Button and Modal; named icon action uses a small glyph within a token-sized touch target    | None             |

AST review found no raw JSX action buttons or clickable div/span substitutes in the changed production files. Native creation inspection found only the clipboard textarea boundary above. Role-bearing status/log/dialog containers are informational or structural, not action substitutes.

Verdict totals: **0 fix**, **5 keep with reason**, **0 abstract**.
