import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  CLI_AGENT,
  type CliAgentType,
  type ModelType,
} from "@src/api/tauri/rpc/schemas/validation";
import type { RecentModelEntry } from "@src/store/session/recentModelEntriesAtom";

import { MARKET_PROFILES_CHANGED_EVENT } from "./events";
import {
  type Connection,
  type Entry,
  loadConnections,
  loadEntries,
  prepareSessionSource,
} from "./rpc";

export type MarketProfileAgent = "claude_code" | "codex";

/**
 * A purchased Market service adapted to ORG2's existing execution-profile UI.
 * It deliberately contains no API key. `connection` plus the entitlement
 * identifiers are only used to ask the backend for an opaque credentialSource.
 */
export interface MarketExecutionProfile {
  id: string;
  label: string;
  connection: Connection;
  entitlementWorkspaceId: string;
  entitlementId: string;
  serviceId: string;
  modelsByAgent: Record<MarketProfileAgent, string[]>;
  expiresAt: number | null;
}

export interface MarketProfileSource {
  id: string;
  label: string;
  modelType: ModelType;
  cliAgentType: MarketProfileAgent;
  modelIds: string[];
  profile: MarketExecutionProfile;
}

function isActiveEntry(entry: Entry, now: number): boolean {
  return (
    entry.status === "active" &&
    (entry.expires_at === null || entry.expires_at > now)
  );
}

/** Pure adapter shared by the native model picker and external-app settings. */
export function adaptMarketEntries(
  connection: Connection,
  entries: Entry[],
  now = Date.now()
): MarketExecutionProfile[] {
  return entries
    .filter((entry) => isActiveEntry(entry, now))
    .map((entry) => ({
      id: `market:${connection.identity_user_id}:${entry.entitlement_id}`,
      label: entry.service_name,
      connection,
      entitlementWorkspaceId: entry.workspace_id,
      entitlementId: entry.entitlement_id,
      serviceId: entry.service_id,
      modelsByAgent: {
        claude_code: [...new Set(entry.models_by_agent.claude)],
        codex: [...new Set(entry.models_by_agent.codex)],
      },
      expiresAt: entry.expires_at,
    }));
}

/** Keep one purchase even if a stale duplicate ORG2 connection is present. */
export function dedupeMarketProfiles(
  profiles: MarketExecutionProfile[]
): MarketExecutionProfile[] {
  const byEntitlement = new Map<string, MarketExecutionProfile>();
  for (const profile of profiles) {
    if (!byEntitlement.has(profile.id)) {
      byEntitlement.set(profile.id, profile);
    }
  }
  return [...byEntitlement.values()];
}

export function marketSourcesForAgent(
  profiles: MarketExecutionProfile[],
  cliAgentType: CliAgentType | string | null | undefined
): MarketProfileSource[] {
  const agent: MarketProfileAgent | null =
    cliAgentType === CLI_AGENT.CLAUDE_CODE
      ? "claude_code"
      : cliAgentType === CLI_AGENT.CODEX
        ? "codex"
        : null;
  if (!agent) return [];

  return profiles.flatMap((profile) => {
    const modelIds = profile.modelsByAgent[agent];
    if (modelIds.length === 0) return [];
    return [
      {
        id: `${profile.id}:${agent}`,
        label: profile.label,
        modelType: agent as ModelType,
        cliAgentType: agent,
        modelIds,
        profile,
      },
    ];
  });
}

export function findMarketSourceForRecent(
  sources: MarketProfileSource[],
  entry: Pick<
    RecentModelEntry,
    "marketProfileId" | "accountName" | "cliAgentType" | "modelId"
  >
): MarketProfileSource | undefined {
  return sources.find(
    (source) =>
      (entry.marketProfileId
        ? source.profile.id === entry.marketProfileId
        : source.label === entry.accountName) &&
      source.cliAgentType === entry.cliAgentType &&
      source.modelIds.includes(entry.modelId)
  );
}

export async function prepareMarketProfileSource(
  source: MarketProfileSource,
  model: string
): Promise<{ credentialSource: string }> {
  if (!source.modelIds.includes(model)) {
    throw new Error(`Market profile does not support model: ${model}`);
  }
  const prepared = await prepareSessionSource(
    source.profile.connection,
    source.profile.entitlementWorkspaceId,
    source.profile.entitlementId,
    source.cliAgentType,
    model
  );
  return {
    credentialSource: prepared.credential_source,
  };
}

export interface MarketProfileLoadResult {
  profiles: MarketExecutionProfile[];
  errors: unknown[];
}

export async function loadMarketExecutionProfilesWithDiagnostics(): Promise<MarketProfileLoadResult> {
  const status = await loadConnections();
  const connections = status.connections.filter(
    (connection) =>
      connection.target === "org2" && connection.phase === "authorization_saved"
  );
  const results = await Promise.allSettled(
    connections.map(async (connection) =>
      adaptMarketEntries(connection, await loadEntries(connection))
    )
  );
  return {
    profiles: dedupeMarketProfiles(
      results.flatMap((result) =>
        result.status === "fulfilled" ? result.value : []
      )
    ),
    errors: results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : []
    ),
  };
}

export async function loadMarketExecutionProfiles(): Promise<
  MarketExecutionProfile[]
> {
  const result = await loadMarketExecutionProfilesWithDiagnostics();
  if (result.errors.length > 0) throw result.errors[0];
  return result.profiles;
}

let cachedLoad: MarketProfileLoadResult | null = null;
let inFlightLoad: Promise<MarketProfileLoadResult> | null = null;
let sharedLoadGeneration = 0;

export function invalidateMarketProfileCache(): void {
  cachedLoad = null;
  sharedLoadGeneration += 1;
}

export async function loadCachedMarketExecutionProfiles(
  force = false
): Promise<MarketProfileLoadResult> {
  if (!force && cachedLoad) return cachedLoad;
  if (!force && inFlightLoad) return inFlightLoad;
  if (force) invalidateMarketProfileCache();
  const generation = sharedLoadGeneration;
  const request = loadMarketExecutionProfilesWithDiagnostics().then(
    (result) => {
      if (generation === sharedLoadGeneration) cachedLoad = result;
      return result;
    }
  );
  inFlightLoad = request;
  try {
    return await request;
  } finally {
    if (inFlightLoad === request) inFlightLoad = null;
  }
}

/**
 * Loads Market profiles only while a profile picker needs them. Browser/app
 * handoff emits `market-profiles-changed`, which refreshes this source without
 * requiring an ORG2 restart.
 */
export function useMarketExecutionProfiles(options: {
  enabled: boolean;
  cliAgentType?: CliAgentType | string | null;
}) {
  const { enabled, cliAgentType } = options;
  const [profiles, setProfiles] = useState<MarketExecutionProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const generationRef = useRef(0);

  const load = useCallback(
    async (force = false) => {
      if (!enabled) return;
      const generation = ++generationRef.current;
      setLoading(true);
      try {
        const result = await loadCachedMarketExecutionProfiles(force);
        if (generation !== generationRef.current) return;
        setProfiles(result.profiles);
        setError(
          result.errors.length > 0
            ? result.errors
                .map((cause) =>
                  cause instanceof Error ? cause.message : String(cause)
                )
                .join("; ")
            : null
        );
      } catch (cause) {
        if (generation !== generationRef.current) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (generation === generationRef.current) {
          setLoading(false);
          setHasLoaded(true);
        }
      }
    },
    [enabled]
  );

  const refresh = useCallback(async () => load(true), [load]);

  useEffect(() => {
    if (!enabled) return;
    load(false).catch(() => undefined);
  }, [enabled, load]);

  useEffect(() => {
    const handleProfilesChanged = () => {
      load(true).catch(() => undefined);
    };
    window.addEventListener(
      MARKET_PROFILES_CHANGED_EVENT,
      handleProfilesChanged
    );
    return () =>
      window.removeEventListener(
        MARKET_PROFILES_CHANGED_EVENT,
        handleProfilesChanged
      );
  }, [load]);

  const sources = useMemo(
    () => marketSourcesForAgent(profiles, cliAgentType),
    [profiles, cliAgentType]
  );

  return {
    profiles,
    sources,
    loading: loading || (enabled && !hasLoaded),
    error,
    refresh,
  };
}
