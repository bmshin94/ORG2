// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import AppConnectionPage from "./AppConnectionPage";

const configure = vi.fn();
const restore = vi.fn();
const open = vi.fn();
const reload = vi.fn();
const refresh = vi.fn();
let connected = false;
const identity = "11111111-1111-4111-8111-111111111111";
const appliedSelection = (entitlementId: string) => {
  const encoded = btoa(
    JSON.stringify({
      metadata: {
        identity_user_id: identity,
        workspace_id: "ws_anchor",
        target: "org2",
      },
      workspace_id: "ws_purchase",
      entitlement_id: entitlementId,
    })
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  return `market:${encoded}`;
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string | number>) =>
      values ? `${key}:${values.index}:${values.count}` : key,
  }),
}));
vi.mock("jotai", () => ({
  useAtomValue: () => [
    {
      marketProfileId: "market:user:second",
      cliAgentType: "claude_code",
      modelId: "claude-b",
    },
  ],
}));
vi.mock("@src/features/MarketConnect/externalAppBridge", () => ({
  configureExternalMarketTarget: (...args: unknown[]) => configure(...args),
  restoreExternalMarketTarget: (...args: unknown[]) => restore(...args),
  isMarketManagedView: (view: {
    config?: { mode?: string; selectedKeyId?: string };
  }) =>
    Boolean(
      view?.config?.mode === "orgii_managed" &&
      view.config.selectedKeyId?.startsWith("market:")
    ),
}));
vi.mock("@src/features/MarketConnect/launch", () => ({
  openConfiguredMarketClient: (...args: unknown[]) => open(...args),
}));

const profiles = [
  {
    id: "market:user:first",
    label: "Same service",
    connection: {
      identity_user_id: identity,
      workspace_id: "ws_anchor",
      target: "org2",
    },
    entitlementWorkspaceId: "ws_purchase",
    entitlementId: "ent_first",
    serviceId: "service_first",
    modelsByAgent: { claude_code: ["claude-a"], codex: [] },
    expiresAt: null,
  },
  {
    id: "market:user:second",
    label: "Same service",
    connection: {
      identity_user_id: identity,
      workspace_id: "ws_anchor",
      target: "org2",
    },
    entitlementWorkspaceId: "ws_purchase",
    entitlementId: "ent_second",
    serviceId: "service_second",
    modelsByAgent: { claude_code: ["claude-b"], codex: ["gpt-b"] },
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
  refreshHarnessConnections: (...args: unknown[]) => refresh(...args),
  useHarnessConnection: () => ({
    view: {
      installed: true,
      config: {
        supported: true,
        mode: connected ? "orgii_managed" : "default",
        conflict: false,
        selectedKeyId: connected ? appliedSelection("ent_second") : null,
        selectedModel: connected ? "claude-b" : null,
        targetFiles: [],
      },
      choices: [{ keyId: "key-a", name: "My API", models: ["model-a"] }],
    },
    loading: false,
    error: null,
    reload,
  }),
}));
vi.mock("@src/components/Message", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  connected = false;
  configure.mockResolvedValue({});
  restore.mockResolvedValue({});
  open.mockResolvedValue({});
  reload.mockResolvedValue({ status: "updated" });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(target: "claude_code" | "claude_desktop" | "codex") {
  await act(async () =>
    root.render(
      createElement(AppConnectionPage, {
        target,
        onConfigureAccounts: vi.fn(),
      })
    )
  );
}

function button(text: string) {
  return [...container.querySelectorAll("button")].find(
    (item) => item.textContent === text
  ) as HTMLButtonElement;
}

it("selects provider first and keeps duplicate purchases as separate private connections", async () => {
  await render("claude_code");
  await act(async () => button("common:actions.select").click());
  expect(container.textContent).toContain("harnessConnections.connection");
  expect(container.textContent).not.toContain("Same service");

  const marketProvider = [...container.querySelectorAll("button")].find(
    (item) =>
      item.textContent?.startsWith("harnessConnections.marketApps.workspace")
  ) as HTMLButtonElement;
  await act(async () => marketProvider.click());
  const first = container.querySelector(
    '[data-testid="market-connection-ent_first"]'
  ) as HTMLButtonElement;
  const second = container.querySelector(
    '[data-testid="market-connection-ent_second"]'
  ) as HTMLButtonElement;
  expect(first.textContent).toContain("Same service");
  expect(second.textContent).toContain("Same service");
  expect(first.textContent).toContain(
    "harnessConnections.marketApps.workspaceNumber:1:2"
  );
  expect(second.textContent).toContain(
    "harnessConnections.marketApps.workspaceNumber:2:2"
  );
  expect(container.textContent).not.toMatch(/seller|email/i);

  await act(async () => first.click());
  expect(configure).toHaveBeenCalledWith(
    profiles[0],
    "claude_code",
    undefined,
    undefined
  );
  expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(
    reload.mock.invocationCallOrder[0]
  );
});

it("opens Claude Code in a terminal and Desktop as an app", async () => {
  connected = true;
  await render("claude_code");
  expect(container.textContent).toContain(
    "harnessConnections.marketApps.workspaceNumber:2:2"
  );
  await act(async () =>
    button("harnessConnections.marketApps.openTerminal").click()
  );
  expect(open).toHaveBeenCalledWith(
    "claude_code",
    appliedSelection("ent_second"),
    "claude-b"
  );

  await act(async () =>
    root.render(
      createElement(AppConnectionPage, {
        target: "claude_desktop",
        onConfigureAccounts: vi.fn(),
      })
    )
  );
  expect(container.textContent).toContain("harnessConnections.marketApps.open");
  expect(container.textContent).not.toContain(
    "harnessConnections.marketApps.openTerminal"
  );
});

it("restores only the selected target app", async () => {
  connected = true;
  await render("codex");
  await act(async () => button("harnessConnections.restore").click());
  expect(restore).toHaveBeenCalledWith("codex");
});
