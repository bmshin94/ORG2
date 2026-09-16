// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";

import MarketNativeAppConnections from "./MarketNativeAppConnections";

const configure = vi.fn();
const restore = vi.fn();
const open = vi.fn();
const reload = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) =>
      values ? `${key}:${values.workspace}:${values.model}` : key,
  }),
}));
vi.mock("jotai", () => ({
  useAtomValue: () => [
    {
      modelId: "claude-b",
      marketProfileId: "market:user:second",
      cliAgentType: "claude_code",
    },
  ],
}));
vi.mock("@src/features/MarketConnect/externalAppBridge", () => ({
  configureExternalMarketTarget: (...args: unknown[]) => configure(...args),
  restoreExternalMarketTarget: (...args: unknown[]) => restore(...args),
  isMarketManagedView: (view: { config?: { selectedKeyId?: string } }) =>
    Boolean(view?.config?.selectedKeyId?.startsWith("market:")),
}));
vi.mock("@src/features/MarketConnect/launch", () => ({
  openConfiguredMarketClient: (...args: unknown[]) => open(...args),
}));
const profiles = [
  {
    id: "market:user:first",
    label: "First service",
    connection: {},
    entitlementWorkspaceId: "ws_first",
    entitlementId: "first",
    serviceId: "service-first",
    modelsByAgent: { claude_code: ["claude-a"], codex: ["gpt-a"] },
    expiresAt: null,
  },
  {
    id: "market:user:second",
    label: "Second service",
    connection: {},
    entitlementWorkspaceId: "ws_second",
    entitlementId: "second",
    serviceId: "service-second",
    modelsByAgent: {
      claude_code: ["claude-a", "claude-b"],
      codex: ["gpt-b"],
    },
    expiresAt: null,
  },
];
vi.mock("@src/features/MarketConnect/marketProfiles", () => ({
  useMarketExecutionProfiles: () => ({
    profiles,
    loading: false,
    error: null,
  }),
}));
vi.mock("./useHarnessConnection", () => ({
  refreshHarnessConnections: vi.fn(),
  useHarnessConnection: (target: string) => ({
    view: {
      installed: true,
      config: {
        supported: true,
        mode: "default",
        conflict: false,
        selectedKeyId: null,
        targetFiles: [],
      },
      choices: [],
    },
    error: null,
    loading: false,
    reload,
    target,
  }),
}));
vi.mock("@src/components/Message", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  configure.mockResolvedValue({});
  reload.mockResolvedValue({ status: "updated" });
});

it("uses the current ORG2 Market selection without another workspace or model picker", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(createElement(MarketNativeAppConnections))
    );

    expect(container.textContent).toContain(
      "harnessConnections.marketApps.currentValue:Second service:claude-b"
    );
    expect(container.querySelector("select")).toBeNull();
    expect(container.textContent).toContain("Claude Code");
    expect(container.textContent).toContain("Claude Desktop");
    expect(container.textContent).toContain("Codex");

    const firstConnect = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "harnessConnections.marketApps.connect"
    ) as HTMLButtonElement;
    await act(async () => firstConnect.click());

    expect(configure).toHaveBeenCalledWith(
      profiles[1],
      "claude_code",
      "claude_code",
      "claude-b"
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
