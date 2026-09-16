import { beforeEach, describe, expect, it, vi } from "vitest";

import { rpc } from "@src/api/tauri/rpc";
import type { HarnessConnectionView } from "@src/api/tauri/rpc/schemas/agentOrgs";

import {
  isMarketManagedView,
  modelForExternalTarget,
  restoreConnectedExternalMarketApps,
  syncConnectedExternalMarketApps,
} from "./externalAppBridge";
import type { MarketExecutionProfile } from "./marketProfiles";
import { configureMarketProfile } from "./rpc";

vi.mock("@src/api/tauri/rpc", () => ({
  rpc: {
    agentOrgs: {
      connections: { status: vi.fn() },
      managedConfig: { restoreDefault: vi.fn() },
    },
  },
}));
vi.mock("./rpc", () => ({ configureMarketProfile: vi.fn() }));

const profile = {
  id: "market:user:entitlement",
  label: "Review service",
  connection: {
    identity_user_id: "11111111-1111-4111-8111-111111111111",
    workspace_id: "ws_identity",
    target: "org2",
  },
  entitlementWorkspaceId: "ws_purchase",
  entitlementId: "entitlement",
  serviceId: "service",
  modelsByAgent: {
    claude_code: ["claude-a", "claude-b"],
    codex: ["gpt-a"],
  },
  expiresAt: null,
} satisfies MarketExecutionProfile;

function view(
  key: string | null,
  agentName = "claude_code"
): HarnessConnectionView {
  return {
    installed: true,
    config: {
      agentName,
      supported: true,
      mode: key ? "orgii_managed" : "default",
      hasDefaultBackup: Boolean(key),
      conflict: false,
      selectedKeyId: key,
      targetFiles: [],
    },
    choices: [],
  };
}

beforeEach(() => vi.clearAllMocks());

describe("external Market app routing", () => {
  it("uses the selected model only for its compatible client family", () => {
    expect(
      modelForExternalTarget(
        profile,
        "claude_desktop",
        "claude_code",
        "claude-b"
      )
    ).toBe("claude-b");
    expect(
      modelForExternalTarget(profile, "codex", "claude_code", "claude-b")
    ).toBe("gpt-a");
  });

  it("recognizes only opaque Market selections as connected", () => {
    expect(isMarketManagedView(view("market:opaque"))).toBe(true);
    expect(isMarketManagedView(view("key-vault-id"))).toBe(false);
  });

  it("updates only clients that already opted into Market", async () => {
    vi.mocked(rpc.agentOrgs.connections.status)
      .mockResolvedValueOnce(view("market:old", "claude_code"))
      .mockResolvedValueOnce(view(null, "claude_desktop"))
      .mockResolvedValueOnce(view("market:old", "codex"));
    vi.mocked(configureMarketProfile).mockResolvedValue({} as never);

    await syncConnectedExternalMarketApps(profile, "claude_code", "claude-b");

    expect(configureMarketProfile).toHaveBeenCalledTimes(2);
    expect(configureMarketProfile).toHaveBeenNthCalledWith(
      1,
      profile.connection,
      "ws_purchase",
      "entitlement",
      "claude_code",
      "claude-b",
      {}
    );
    expect(configureMarketProfile).toHaveBeenNthCalledWith(
      2,
      profile.connection,
      "ws_purchase",
      "entitlement",
      "codex",
      "gpt-a",
      {}
    );
  });

  it("restores only clients currently using Market", async () => {
    vi.mocked(rpc.agentOrgs.connections.status)
      .mockResolvedValueOnce(view("market:old", "claude_code"))
      .mockResolvedValueOnce(view("personal", "claude_desktop"))
      .mockResolvedValueOnce(view(null, "codex"));
    vi.mocked(rpc.agentOrgs.managedConfig.restoreDefault).mockResolvedValue(
      undefined as never
    );

    await restoreConnectedExternalMarketApps();

    expect(rpc.agentOrgs.managedConfig.restoreDefault).toHaveBeenCalledOnce();
    expect(rpc.agentOrgs.managedConfig.restoreDefault).toHaveBeenCalledWith({
      agentName: "claude_code",
      force: false,
    });
  });
});
