import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildSourceOptions } from "@src/scaffold/GlobalSpotlight/palettes/UnifiedModelPalette/sourceItems";
import {
  deriveLastModelSelection,
  extractModelPair,
} from "@src/store/session/creatorDefaultModelAtom";
import { findRecentByCredentialSource } from "@src/store/session/recentModelEntriesAtom";

import {
  adaptMarketEntries,
  dedupeMarketProfiles,
  findMarketSourceForRecent,
  invalidateMarketProfileCache,
  loadCachedMarketExecutionProfiles,
  loadMarketExecutionProfiles,
  loadMarketExecutionProfilesWithDiagnostics,
  marketConnectionOptions,
  marketSourcesForAgent,
  prepareMarketProfileSource,
} from "./marketProfiles";
import type { Connection, Entry } from "./rpc";

const api = vi.hoisted(() => ({
  loadConnections: vi.fn(),
  loadEntries: vi.fn(),
  prepareSessionSource: vi.fn(),
}));

vi.mock("./rpc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./rpc")>()),
  ...api,
}));

const connection: Connection = {
  identity_user_id: "11111111-1111-4111-8111-111111111111",
  workspace_id: "ws_buyer",
  target: "org2",
};

const entries: Entry[] = [
  {
    workspace_id: "ws_entitlement",
    entitlement_id: "ent_1",
    service_id: "svc_1",
    service_name: "Multi-model service",
    models: ["claude-sonnet", "gpt-codex"],
    models_by_agent: {
      claude: ["claude-sonnet"],
      codex: ["gpt-codex"],
    },
    status: "active",
    expires_at: null,
  },
  {
    workspace_id: "ws_expired",
    entitlement_id: "ent_expired",
    service_id: "svc_2",
    service_name: "Expired service",
    models: ["claude-sonnet"],
    models_by_agent: { claude: ["claude-sonnet"], codex: [] },
    status: "active",
    expires_at: 10,
  },
];

describe("Market execution profiles", () => {
  beforeEach(() => vi.clearAllMocks());

  it("adapts active purchases without creating a static key", () => {
    const profiles = adaptMarketEntries(connection, entries, 100);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({
      label: "Multi-model service",
      entitlementWorkspaceId: "ws_entitlement",
      entitlementId: "ent_1",
      modelsByAgent: {
        claude_code: ["claude-sonnet"],
        codex: ["gpt-codex"],
      },
    });
    expect(profiles[0]).not.toHaveProperty("key");
    expect(profiles[0]).not.toHaveProperty("apiKey");
  });

  it("projects the same purchase into agent-compatible profile sources", () => {
    const profiles = adaptMarketEntries(connection, entries, 100);
    expect(marketSourcesForAgent(profiles, "claude_code")[0]).toMatchObject({
      label: "Multi-model service",
      cliAgentType: "claude_code",
      modelIds: ["claude-sonnet"],
    });
    expect(marketSourcesForAgent(profiles, "codex")[0]).toMatchObject({
      cliAgentType: "codex",
      modelIds: ["gpt-codex"],
    });
    expect(marketSourcesForAgent(profiles, "cursor_cli")).toEqual([]);
  });

  it("keeps multiple compatible purchases as separate existing UI sources", () => {
    const first = adaptMarketEntries(connection, entries, 100)[0];
    const second = {
      ...first,
      id: `${first.id}:second`,
      entitlementId: "ent_2",
      label: "Second service",
    };
    const sources = marketSourcesForAgent([first, second], "claude_code");

    expect(
      buildSourceOptions(["claude-sonnet"], [], true, sources).map(
        (source) => source.label
      )
    ).toEqual(["Multi-model service", "Second service"]);
  });

  it("projects every entitlement as a buyer-safe connection option", () => {
    const first = adaptMarketEntries(connection, entries, 100)[0];
    const profiles = [
      first,
      {
        ...first,
        id: "market:user:ent_2",
        entitlementWorkspaceId: "ws_second",
        entitlementId: "ent_2",
        modelsByAgent: {
          claude_code: ["claude-sonnet", "shared-model"],
          codex: ["gpt-codex", "shared-model"],
        },
      },
    ];

    const options = marketConnectionOptions(profiles);
    expect(options).toHaveLength(2);
    expect(options.map((option) => option.title)).toEqual([
      "Multi-model service",
      "Multi-model service",
    ]);
    expect(options.map((option) => option.duplicateOrdinal)).toEqual([1, 2]);
    expect(options.map((option) => option.duplicateCount)).toEqual([2, 2]);
    expect(options[1]).toMatchObject({
      modelCount: 3,
      sourceRef: {
        kind: "market",
        entitlementWorkspaceId: "ws_second",
        entitlementId: "ent_2",
      },
    });
    expect(options[1]).not.toHaveProperty("seller");
    expect(options[1]).not.toHaveProperty("sellerName");
  });

  it("filters connection options by the tested client compatibility matrix", () => {
    const first = adaptMarketEntries(connection, entries, 100)[0];
    const codexOnly = {
      ...first,
      id: "market:user:codex-only",
      entitlementId: "ent_codex_only",
      label: "Codex only",
      modelsByAgent: { claude_code: [], codex: ["gpt-codex"] },
    };

    expect(
      marketConnectionOptions([first, codexOnly], "claude_desktop").map(
        (option) => option.title
      )
    ).toEqual(["Multi-model service"]);
    expect(
      marketConnectionOptions([first, codexOnly], "codex").map(
        (option) => option.title
      )
    ).toEqual(["Multi-model service", "Codex only"]);
    expect(
      marketConnectionOptions([codexOnly], "org2")[0].modelsByTarget.org2
    ).toEqual(["gpt-codex"]);
  });

  it("numbers duplicate titles within the compatible target options only", () => {
    const first = adaptMarketEntries(connection, entries, 100)[0];
    const codexOnly = {
      ...first,
      id: "market:user:codex-only",
      entitlementId: "ent_codex_only",
      modelsByAgent: { claude_code: [], codex: ["gpt-codex"] },
    };
    const secondClaude = {
      ...first,
      id: "market:user:second-claude",
      entitlementId: "ent_second_claude",
    };

    const options = marketConnectionOptions(
      [codexOnly, first, secondClaude],
      "claude_code"
    );
    expect(options.map((option) => option.duplicateOrdinal)).toEqual([1, 2]);
    expect(options.map((option) => option.duplicateCount)).toEqual([2, 2]);
  });

  it("rebinds a recent selection only to a still-compatible catalog profile", () => {
    const [source] = marketSourcesForAgent(
      adaptMarketEntries(connection, entries, 100),
      "claude_code"
    );
    const recent = {
      modelId: "claude-sonnet",
      sourceType: "own_key" as const,
      accountName: source.label,
      credentialSource: "market:old-selection",
      marketProfileId: source.profile.id,
      modelType: "claude_code" as const,
      cliAgentType: "claude_code" as const,
    };

    expect(findMarketSourceForRecent([source], recent)).toBe(source);
    expect(
      findMarketSourceForRecent([source], {
        ...recent,
        modelId: "removed-model",
      })
    ).toBeUndefined();
    expect(
      findRecentByCredentialSource([recent], "market:old-selection")
        ?.accountName
    ).toBe("Multi-model service");
  });

  it("dedupes by identity plus entitlement instead of entitlement alone", () => {
    const first = adaptMarketEntries(connection, entries, 100)[0];
    const second = {
      ...first,
      id: "market:22222222-2222-4222-8222-222222222222:ent_1",
      connection: {
        ...connection,
        identity_user_id: "22222222-2222-4222-8222-222222222222",
      },
    };
    expect(dedupeMarketProfiles([first, first, second])).toHaveLength(2);
  });

  it("prepares an opaque credential source through the backend", async () => {
    api.prepareSessionSource.mockResolvedValue({
      credential_source: "market:opaque-selection",
    });
    const source = marketSourcesForAgent(
      adaptMarketEntries(connection, entries, 100),
      "claude_code"
    )[0];

    await expect(
      prepareMarketProfileSource(source, "claude-sonnet")
    ).resolves.toEqual({
      credentialSource: "market:opaque-selection",
    });
    expect(api.prepareSessionSource).toHaveBeenCalledWith(
      connection,
      "ws_entitlement",
      "ent_1",
      "claude_code",
      "claude-sonnet"
    );
  });

  it("round-trips a Market profile through the creator selection", () => {
    const pair = extractModelPair({
      keySource: "own_key",
      model: "claude-sonnet",
      cliAgentType: "claude_code",
      credentialSource: "market:opaque-selection",
      selectedSourceLabel: "Multi-model service",
      selectedSourceModelType: "claude_code",
    });

    expect(pair).toMatchObject({
      modelId: "claude-sonnet",
      accountId: undefined,
      credentialSource: "market:opaque-selection",
      accountName: "Multi-model service",
      cliAgentType: "claude_code",
    });
    expect(deriveLastModelSelection(pair!)).toMatchObject({
      model: "claude-sonnet",
      selectedAccountId: undefined,
      credentialSource: "market:opaque-selection",
      selectedSourceLabel: "Multi-model service",
    });
  });

  it("does not turn a total load failure into an empty purchase list", async () => {
    api.loadConnections.mockResolvedValue({
      enabled: true,
      app_scheme: "orgii",
      buyer_persistent_credentials: true,
      connections: [
        { ...connection, phase: "authorization_saved" },
        {
          ...connection,
          workspace_id: "ws_other",
          phase: "authorization_saved",
        },
      ],
    });
    api.loadEntries.mockRejectedValue(new Error("network unavailable"));

    await expect(loadMarketExecutionProfiles()).rejects.toThrow(
      "network unavailable"
    );
  });

  it("does not project legacy app-scoped grants as purchased workspaces", async () => {
    api.loadConnections.mockResolvedValue({
      enabled: true,
      app_scheme: "orgii",
      buyer_persistent_credentials: true,
      connections: [
        {
          ...connection,
          target: "codex",
          phase: "authorization_saved",
        },
      ],
    });

    await expect(loadMarketExecutionProfilesWithDiagnostics()).resolves.toEqual(
      { profiles: [], errors: [] }
    );
    expect(api.loadEntries).not.toHaveBeenCalled();
  });

  it("returns partial profiles together with load diagnostics", async () => {
    const secondConnection = { ...connection, workspace_id: "ws_other" };
    api.loadConnections.mockResolvedValue({
      enabled: true,
      app_scheme: "orgii",
      buyer_persistent_credentials: true,
      connections: [
        { ...connection, phase: "authorization_saved" },
        { ...secondConnection, phase: "authorization_saved" },
      ],
    });
    api.loadEntries.mockImplementation((current: Connection) =>
      current.workspace_id === connection.workspace_id
        ? Promise.resolve(entries)
        : Promise.reject(new Error("second connection unavailable"))
    );

    const result = await loadMarketExecutionProfilesWithDiagnostics();
    expect(result.profiles).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
  });

  it("does not let an older profile response replace a forced refresh", async () => {
    invalidateMarketProfileCache();
    api.loadConnections.mockResolvedValue({
      enabled: true,
      app_scheme: "orgii",
      buyer_persistent_credentials: true,
      connections: [{ ...connection, phase: "authorization_saved" }],
    });
    let resolveFirst: ((value: Entry[]) => void) | undefined;
    api.loadEntries
      .mockImplementationOnce(
        () =>
          new Promise<Entry[]>((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockResolvedValueOnce([
        { ...entries[0], entitlement_id: "ent_new", service_name: "New" },
      ]);

    const oldRequest = loadCachedMarketExecutionProfiles();
    const newRequest = loadCachedMarketExecutionProfiles(true);
    await expect(newRequest).resolves.toMatchObject({
      profiles: [{ label: "New" }],
    });
    resolveFirst?.([{ ...entries[0], service_name: "Old" }]);
    await oldRequest;

    await expect(loadCachedMarketExecutionProfiles()).resolves.toMatchObject({
      profiles: [{ label: "New" }],
    });
  });
});
