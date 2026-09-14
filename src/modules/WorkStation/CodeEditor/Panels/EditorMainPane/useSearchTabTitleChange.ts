import { useCallback } from "react";

import type { PanelState } from "@src/store/workstation/tabs";

/** Renames a search tab after its query (`Search: <query>`, or `Search` when empty). */
export function useSearchTabTitleChange(
  updatePaneState: (updater: (state: PanelState) => PanelState) => void
): (tabId: string, query: string) => void {
  return useCallback(
    (tabId: string, query: string) => {
      const trimmedQuery = query.trim();
      const nextTitle = trimmedQuery ? `Search: ${trimmedQuery}` : "Search";

      updatePaneState((state) => {
        const tabs = state.tabs;
        const targetTab = tabs.find((tab) => tab.id === tabId);
        if (!targetTab || targetTab.title === nextTitle) {
          return state;
        }

        return {
          ...state,
          tabs: tabs.map((tab) =>
            tab.id === tabId ? { ...tab, title: nextTitle } : tab
          ),
        };
      });
    },
    [updatePaneState]
  );
}
