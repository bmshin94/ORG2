import { beforeEach, expect, it, vi } from "vitest";

import { openConfiguredMarketClient } from "./launch";

const api = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@src/api/tauri/rpc/invoke", async (load) => ({
  ...(await load<typeof import("@src/api/tauri/rpc/invoke")>()),
  typedInvoke: api.invoke,
}));

beforeEach(() => vi.resetAllMocks());

it("opens the already-configured normal client without sending credentials", async () => {
  api.invoke.mockResolvedValue(null);

  await openConfiguredMarketClient(
    "claude_code",
    "market:selection",
    "model-a"
  );

  expect(api.invoke).toHaveBeenCalledWith(expect.anything(), {
    agent: "claude_code",
    selection: "market:selection",
    model: "model-a",
  });
});
