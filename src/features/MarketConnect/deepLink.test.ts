// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { handleMarketConnectionUrl } from "./deepLink";
import {
  MARKET_AUTHORIZATION_SAVED_EVENT,
  MARKET_CONNECTION_ERROR_EVENT,
  MARKET_PROFILES_CHANGED_EVENT,
} from "./events";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  open: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  loadConnections: vi.fn(),
  loadEntries: vi.fn(),
  completeCloud: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.open }));
vi.mock("@src/components/Message", () => ({
  default: { success: mocks.success, error: mocks.error },
}));
vi.mock("@src/i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("@src/features/Org2Cloud/completeSignIn", () => ({
  completeOrg2CloudSignIn: mocks.completeCloud,
}));
vi.mock("./rpc", () => ({
  loadConnections: mocks.loadConnections,
  loadEntries: mocks.loadEntries,
}));
vi.mock("@src/api/tauri/rpc/invoke", async (original) => ({
  ...(await original<typeof import("@src/api/tauri/rpc/invoke")>()),
  typedInvoke: mocks.invoke,
}));

const selection = "orgii://market/connect?workspace_id=ws_example&target=codex";
const callback = "orgii://market/authorized?code=fixture&state=fixture";
const approval =
  "https://market.org2.dev/buyer/connect/authorize?state=fixture";
describe("installed ORG2 Market handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.open.mockResolvedValue(undefined);
    mocks.loadConnections.mockResolvedValue({ connections: [] });
    mocks.loadEntries.mockResolvedValue([]);
  });

  it("leaves unrelated deep links to their existing owner", () => {
    expect(handleMarketConnectionUrl("orgii://cloud/join?invite=x")).toBe(
      false
    );
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("opens the fixed approval destination and never reports connected", async () => {
    mocks.invoke.mockResolvedValue(approval);
    expect(handleMarketConnectionUrl(selection)).toBe(true);
    await vi.waitFor(() => expect(mocks.open).toHaveBeenCalledWith(approval));
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it("opens purchased services directly when ORG2 already holds Market authorization", async () => {
    const connection = {
      identity_user_id: "11111111-1111-4111-8111-111111111111",
      workspace_id: "ws_anchor",
      target: "org2",
      phase: "authorization_saved",
    };
    mocks.loadConnections.mockResolvedValue({ connections: [connection] });
    mocks.loadEntries.mockResolvedValue([
      {
        workspace_id: "ws_example",
        entitlement_id: "ent_example",
      },
    ]);
    const opened = vi.fn();
    const profiles = vi.fn();
    window.addEventListener("market-connection-open", opened);
    window.addEventListener(MARKET_PROFILES_CHANGED_EVENT, profiles);
    expect(
      handleMarketConnectionUrl(
        "orgii://market/connect?workspace_id=ws_example&target=org2"
      )
    ).toBe(true);
    await vi.waitFor(() =>
      expect(mocks.loadConnections).toHaveBeenCalledTimes(1)
    );
    expect(mocks.loadEntries).toHaveBeenCalledWith(connection);
    await vi.waitFor(() => expect(opened).toHaveBeenCalledOnce());
    expect(profiles).toHaveBeenCalledOnce();
    expect((profiles.mock.calls[0]?.[0] as CustomEvent).detail).toEqual(
      connection
    );
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
    window.removeEventListener("market-connection-open", opened);
    window.removeEventListener(MARKET_PROFILES_CHANGED_EVENT, profiles);
  });

  it("cancels enrollment when an unexpected destination is returned", async () => {
    mocks.invoke
      .mockResolvedValueOnce("https://evil.test/authorize")
      .mockResolvedValueOnce(undefined);
    handleMarketConnectionUrl(selection);
    await vi.waitFor(() => expect(mocks.error).toHaveBeenCalledTimes(1));
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.invoke.mock.calls[1][0].command).toBe(
      "market_connection_cancel"
    );
  });

  it("preserves a callback arriving before the browser-open operation completes", async () => {
    let opened!: () => void;
    mocks.open.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          opened = resolve;
        })
    );
    mocks.invoke.mockResolvedValueOnce(approval).mockResolvedValueOnce({
      identity_user_id: "11111111-1111-4111-8111-111111111111",
      workspace_id: "ws_example",
      target: "codex",
      phase: "authorization_saved",
    });
    handleMarketConnectionUrl(selection);
    await vi.waitFor(() => expect(mocks.open).toHaveBeenCalledTimes(1));
    handleMarketConnectionUrl(callback);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    opened();
    await vi.waitFor(() => expect(mocks.success).toHaveBeenCalledTimes(1));
    expect(mocks.invoke.mock.calls[1][0].command).toBe(
      "market_connection_complete"
    );
    expect(mocks.success).toHaveBeenCalledWith(
      "integrations:marketConnection.authorizationSaved"
    );
  });

  it("keeps cloud tokens out of native IPC and completes the ORG2 login handoff", async () => {
    const user = "11111111-1111-4111-8111-111111111111";
    const payload = btoa(JSON.stringify({ sub: user }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const access = `header.${payload}.signature`;
    mocks.invoke.mockResolvedValueOnce({
      identity_user_id: user,
      workspace_id: "ws_example",
      target: "org2",
      phase: "authorization_saved",
    });
    const raw = `${callback}#${new URLSearchParams({
      access_token: access,
      refresh_token: "refresh-secret",
      expires_at: String(Date.now() / 1000 + 3600),
    })}`;
    const saved = vi.fn();
    const profiles = vi.fn();
    window.addEventListener(MARKET_AUTHORIZATION_SAVED_EVENT, saved);
    window.addEventListener(MARKET_PROFILES_CHANGED_EVENT, profiles);
    expect(handleMarketConnectionUrl(raw)).toBe(true);
    await vi.waitFor(() => expect(mocks.completeCloud).toHaveBeenCalledOnce());
    const invokeRaw = mocks.invoke.mock.calls[0]?.[1]?.raw as string;
    expect(invokeRaw).not.toContain("access_token");
    expect(invokeRaw).not.toContain("refresh-secret");
    expect(mocks.completeCloud.mock.calls[0]?.[0]).toMatchObject({
      accessToken: access,
      refreshToken: "refresh-secret",
    });
    expect(saved).toHaveBeenCalledOnce();
    expect(profiles).toHaveBeenCalledOnce();
    expect(mocks.success).not.toHaveBeenCalled();
    window.removeEventListener(MARKET_AUTHORIZATION_SAVED_EVENT, saved);
    window.removeEventListener(MARKET_PROFILES_CHANGED_EVENT, profiles);
  });

  it("silently ignores the fallback link after the same authorization already completed", async () => {
    const state = "a".repeat(43);
    const duplicate = `orgii://market/authorized?code=fixture&state=${state}`;
    mocks.invoke.mockResolvedValueOnce({
      identity_user_id: "11111111-1111-4111-8111-111111111111",
      workspace_id: "ws_example",
      target: "org2",
      phase: "authorization_saved",
    });

    expect(handleMarketConnectionUrl(duplicate)).toBe(true);
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledOnce());
    expect(handleMarketConnectionUrl(duplicate)).toBe(true);
    await Promise.resolve();

    expect(mocks.invoke).toHaveBeenCalledOnce();
    expect(mocks.error).not.toHaveBeenCalled();
  });
});

it("reports unsupported buyer credential storage without opening authorization", async () => {
  vi.clearAllMocks();
  mocks.invoke.mockRejectedValueOnce(
    new Error("market_buyer_credential_store_unavailable")
  );
  const errors = vi.fn();
  window.addEventListener(MARKET_CONNECTION_ERROR_EVENT, errors);
  handleMarketConnectionUrl(selection);
  await vi.waitFor(() =>
    expect(mocks.error).toHaveBeenCalledWith(
      "integrations:marketConnection.platformUnavailable"
    )
  );
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.success).not.toHaveBeenCalled();
  expect(errors).toHaveBeenCalledOnce();
  expect((errors.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
    code: "secure-storage-unavailable",
    operation: "begin-authorization",
    target: "codex",
  });
  window.removeEventListener(MARKET_CONNECTION_ERROR_EVENT, errors);
});
