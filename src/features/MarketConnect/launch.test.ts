import { beforeEach, expect, it, vi } from "vitest";

import { prepareLaunch } from "./launch";

const api = vi.hoisted(() => ({
  stat: vi.fn(),
  agents: vi.fn(),
  config: vi.fn(),
  create: vi.fn(),
  release: vi.fn(),
  command: vi.fn(),
  profile: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({ stat: api.stat }));
vi.mock("@src/api/services/availableAgents", () => ({
  loadAvailableAgents: api.agents,
}));
vi.mock("@src/api/tauri/rpc/invoke", async (load) => ({
  ...(await load<typeof import("@src/api/tauri/rpc/invoke")>()),
  typedInvoke: api.profile,
}));
vi.mock("./rpc", () => ({ loadConfig: api.config }));
vi.mock("@src/api/tauri/agent/cliTerminalSession", () => ({
  appendCliCommandArgs: (command: string) => command,
  withCliCommandEnvironment: (command: string) => command,
  cliAgentCreateTuiSession: api.create,
  cliAgentTuiRelease: api.release,
  resolveCliTuiCommand: api.command,
  deriveExpectedProcess: () => "codex",
}));
const connection = {
  identity_user_id: "11111111-1111-4111-8111-111111111111",
  workspace_id: "ws_one",
  target: "codex" as const,
};
const config = {
  mode: "orgii_managed",
  conflict: false,
  selectedKeyId: "market:selection",
  selectedModel: "gpt-5.3-codex",
};
const launch = (active = () => true) =>
  prepareLaunch(
    connection,
    "market:selection",
    "gpt-5.3-codex",
    "/project with spaces",
    active
  );
beforeEach(() => {
  vi.resetAllMocks();
  api.profile.mockResolvedValue({
    args: [],
    env: { CODEX_HOME: "/private/snapshot" },
  });
  api.stat.mockResolvedValue({ isDirectory: true });
  api.agents.mockResolvedValue([
    { name: "codex", installed: true, command: "codex", displayName: "Codex" },
  ]);
  api.config.mockResolvedValue(config);
  api.command.mockResolvedValue("codex");
  api.create.mockResolvedValue({ sessionId: "cli_new" });
});
it("creates the selected client in the selected folder with a managed session and no prompt", async () => {
  expect(await launch()).toMatchObject({
    cliAgentType: "codex",
    cwd: "/project with spaces",
    agentSessionId: "cli_new",
    command: "codex",
  });
  expect(api.create).toHaveBeenCalledWith({
    platform: "codex",
    name: "Codex",
    model: "gpt-5.3-codex",
    repoPath: "/project with spaces",
  });
  expect(api.release).not.toHaveBeenCalled();
});
it.each([
  { ...config, selectedKeyId: "market:another-workspace" },
  { ...config, conflict: true },
  { ...config, selectedModel: "other-model" },
  { ...config, mode: "default" },
])(
  "refuses changed selection before creating a session: %j",
  async (changed) => {
    api.config.mockResolvedValue(changed);
    await expect(launch()).rejects.toThrow();
    expect(api.create).not.toHaveBeenCalled();
  }
);
it("releases the prepared session if configuration changes while creation is in flight", async () => {
  api.config
    .mockResolvedValueOnce(config)
    .mockResolvedValueOnce({ ...config, conflict: true });
  await expect(launch()).rejects.toThrow();
  expect(api.release).toHaveBeenCalledWith("cli_new");
});
it("does not fall back to an unbound client when session creation fails", async () => {
  api.create.mockRejectedValue(new Error("database unavailable"));
  await expect(launch()).rejects.toThrow("database unavailable");
  expect(api.release).not.toHaveBeenCalled();
});
it("does not create a session when the client is missing or the folder is invalid", async () => {
  api.agents.mockResolvedValue([]);
  await expect(launch()).rejects.toThrow("clientMissing");
  api.stat.mockResolvedValue({ isDirectory: false });
  await expect(launch()).rejects.toThrow("launchFailed");
  expect(api.create).not.toHaveBeenCalled();
});
it("releases an in-flight session if its dialog closes", async () => {
  let active = true;
  api.create.mockImplementation(async () => {
    active = false;
    return { sessionId: "cli_new" };
  });
  await expect(launch(() => active)).rejects.toThrow();
  expect(api.release).toHaveBeenCalledWith("cli_new");
});

it("does not launch if the native profile cannot be frozen", async () => {
  api.profile.mockRejectedValue(new Error("selection changed"));
  await expect(launch()).rejects.toThrow("selection changed");
  expect(api.release).toHaveBeenCalledWith("cli_new");
});
