import { beforeEach, expect, it, vi } from "vitest";

import { configureMarketProfile } from "./rpc";

const api = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@src/api/tauri/rpc/invoke", async (load) => ({
  ...(await load<typeof import("@src/api/tauri/rpc/invoke")>()),
  typedInvoke: api.invoke,
}));

beforeEach(() => vi.resetAllMocks());

it("sends external profile configuration as one cohesive request", async () => {
  api.invoke.mockResolvedValue({});

  await configureMarketProfile(
    {
      identity_user_id: "11111111-1111-4111-8111-111111111111",
      workspace_id: "ws_identity",
      target: "org2",
    },
    "ws_purchase",
    "ent_purchase",
    "codex",
    "gpt-example",
    { config: "sha256:example" }
  );

  expect(api.invoke).toHaveBeenCalledWith(expect.anything(), {
    request: {
      identityUserId: "11111111-1111-4111-8111-111111111111",
      workspaceId: "ws_identity",
      target: "org2",
      entitlementWorkspaceId: "ws_purchase",
      entitlementId: "ent_purchase",
      agent: "codex",
      model: "gpt-example",
      expectedHashes: { config: "sha256:example" },
    },
  });
});
