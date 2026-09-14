// @vitest-environment jsdom
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import ConnectionDialog from "./ConnectionDialog";

const api = vi.hoisted(() => ({
  entries: vi.fn(),
  config: vi.fn(),
  apply: vi.fn(),
  disconnect: vi.fn(),
}));
vi.mock("./WorkspaceLaunch", () => ({ default: () => null }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("./rpc", () => ({
  loadEntries: api.entries,
  loadConfig: api.config,
  applyConfig: api.apply,
  disconnectConfig: api.disconnect,
}));

let root: Root, container: HTMLDivElement;
const connection = {
  identity_user_id: "11111111-1111-4111-8111-111111111111",
  workspace_id: "ws_example",
  target: "codex" as const,
};
const config = {
  agentName: "codex",
  supported: true,
  mode: "default",
  hasDefaultBackup: false,
  conflict: false,
  targetFiles: [{ id: "config", currentHash: "before" }],
  selectedKeyId: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  api.entries.mockResolvedValue([
    {
      entitlement_id: "ent_one",
      service_id: "svc_one",
      service_name: "Purchased listing",
      models: ["claude-sonnet-4-6", "gpt-5.3-codex"],
      models_by_agent: {
        claude: ["claude-sonnet-4-6"],
        codex: ["gpt-5.3-codex"],
      },
      status: "active",
      expires_at: null,
    },
  ]);
  api.config.mockResolvedValue(config);
  api.apply.mockResolvedValue({
    ...config,
    mode: "orgii_managed",
    selectedProvider: "market",
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
function button(label: string) {
  return [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(label)
  ) as HTMLButtonElement;
}
it("configures the purchased compatible model with captured file hashes and only reports configuration", async () => {
  await act(async () =>
    root.render(
      createElement(ConnectionDialog, { connection, onClose: () => {} })
    )
  );
  expect(button("marketConnection.configure").disabled).toBe(false);
  await act(async () => button("marketConnection.configure").click());
  expect(api.apply).toHaveBeenCalledWith(
    connection,
    "ent_one",
    "gpt-5.3-codex",
    { config: "before" }
  );
  expect(document.body.textContent).toContain("marketConnection.configured");
  expect(api.disconnect).not.toHaveBeenCalled();
  expect(button("marketConnection.disconnect")).toBeDefined();
});
it("blocks applying over externally modified configuration", async () => {
  api.config.mockResolvedValue({ ...config, conflict: true });
  await act(async () =>
    root.render(
      createElement(ConnectionDialog, { connection, onClose: () => {} })
    )
  );
  expect(button("marketConnection.configure").disabled).toBe(true);
  expect(document.body.textContent).toContain("marketConnection.conflict");
  expect(api.apply).not.toHaveBeenCalled();
});
it("does not advertise an unfinished client adapter as usable", async () => {
  await act(async () =>
    root.render(
      createElement(ConnectionDialog, {
        connection: { ...connection, target: "claude-app" },
        onClose: () => {},
      })
    )
  );
  expect(document.body.textContent).toContain(
    "marketConnection.adapterPending"
  );
  expect(button("marketConnection.configure").disabled).toBe(true);
  expect(api.entries).not.toHaveBeenCalled();
});

it("reopens a matching saved profile as configured and disconnects its exact entitlement", async () => {
  const key =
    "market:" +
    Buffer.from(
      JSON.stringify({ metadata: connection, entitlement_id: "ent_one" })
    ).toString("base64url");
  api.config.mockResolvedValue({
    ...config,
    mode: "orgii_managed",
    selectedProvider: "market",
    selectedKeyId: key,
    selectedModel: "gpt-5.3-codex",
  });
  api.disconnect.mockResolvedValue(undefined);
  const close = vi.fn();
  await act(async () =>
    root.render(createElement(ConnectionDialog, { connection, onClose: close }))
  );
  expect(document.body.textContent).toContain("marketConnection.configured");
  await act(async () => button("marketConnection.disconnect").click());
  expect(api.disconnect).toHaveBeenCalledWith(connection);
  expect(close).toHaveBeenCalledOnce();
});

it.each(["offline", "pending", "expired"])(
  "keeps local disconnect available when purchases are %s",
  async (state) => {
    const key =
      "market:" +
      Buffer.from(
        JSON.stringify({ metadata: connection, entitlement_id: "ent_one" })
      ).toString("base64url");
    api.config.mockResolvedValue({
      ...config,
      mode: "orgii_managed",
      selectedProvider: "market",
      selectedKeyId: key,
      selectedModel: "gpt-test",
    });
    if (state === "offline")
      api.entries.mockRejectedValue(new Error("offline"));
    else if (state === "pending")
      api.entries.mockReturnValue(new Promise(() => {}));
    else api.entries.mockResolvedValue([]);
    api.disconnect.mockResolvedValue(undefined);
    await act(async () =>
      root.render(
        createElement(ConnectionDialog, { connection, onClose: () => {} })
      )
    );
    expect(button("marketConnection.disconnect").disabled).toBe(false);
    await act(async () => button("marketConnection.disconnect").click());
    expect(api.disconnect).toHaveBeenCalledWith(connection);
    expect(api.apply).not.toHaveBeenCalled();
  }
);

it.each(["claude-app", "org2"] as const)(
  "allows local cleanup for %s even before its launch adapter is available",
  async (target) => {
    const saved = { ...connection, target };
    const close = vi.fn();
    await act(async () =>
      root.render(
        createElement(ConnectionDialog, { connection: saved, onClose: close })
      )
    );
    expect(button("marketConnection.configure").disabled).toBe(true);
    expect(button("marketConnection.disconnect").disabled).toBe(false);
    await act(async () => button("marketConnection.disconnect").click());
    expect(api.disconnect).toHaveBeenCalledWith(saved);
    expect(api.config).not.toHaveBeenCalled();
    expect(api.entries).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  }
);
