import { rpc } from "@src/api/tauri/rpc";
import type { HarnessConnectionView } from "@src/api/tauri/rpc/schemas/agentOrgs";

import type {
  MarketExecutionProfile,
  MarketProfileAgent,
} from "./marketProfiles";
import { configureMarketProfile } from "./rpc";

export type ExternalMarketTarget = "claude_code" | "claude_desktop" | "codex";

export const EXTERNAL_MARKET_TARGETS: readonly ExternalMarketTarget[] = [
  "claude_code",
  "claude_desktop",
  "codex",
];

function profileAgent(target: ExternalMarketTarget): MarketProfileAgent {
  return target === "codex" ? "codex" : "claude_code";
}

export function modelForExternalTarget(
  profile: MarketExecutionProfile,
  target: ExternalMarketTarget,
  preferredAgent?: MarketProfileAgent,
  preferredModel?: string
): string | null {
  const agent = profileAgent(target);
  const models = profile.modelsByAgent[agent];
  if (
    preferredAgent === agent &&
    preferredModel &&
    models.includes(preferredModel)
  ) {
    return preferredModel;
  }
  return models[0] ?? null;
}

export function isMarketManagedView(
  view: HarnessConnectionView | null | undefined
): boolean {
  return Boolean(view?.config.selectedKeyId?.startsWith("market:"));
}

function expectedHashes(view: HarnessConnectionView) {
  return Object.fromEntries(
    view.config.targetFiles.map((file) => [file.id, file.currentHash ?? null])
  );
}

async function readTarget(target: ExternalMarketTarget) {
  return rpc.agentOrgs.connections.status({ agentName: target });
}

export async function configureExternalMarketTarget(
  profile: MarketExecutionProfile,
  target: ExternalMarketTarget,
  preferredAgent?: MarketProfileAgent,
  preferredModel?: string
) {
  const view = await readTarget(target);
  const model = modelForExternalTarget(
    profile,
    target,
    preferredAgent,
    preferredModel
  );
  if (!view.installed) throw new Error("client_not_installed");
  if (!view.config.supported) throw new Error("client_not_supported");
  if (view.config.conflict) throw new Error("client_config_conflict");
  if (!model) throw new Error("workspace_not_supported");
  return configureMarketProfile(
    profile.connection,
    profile.entitlementWorkspaceId,
    profile.entitlementId,
    target,
    model,
    expectedHashes(view)
  );
}

export async function restoreExternalMarketTarget(
  target: ExternalMarketTarget
) {
  const view = await readTarget(target);
  if (!isMarketManagedView(view)) return;
  await rpc.agentOrgs.managedConfig.restoreDefault({
    agentName: target,
    force: false,
  });
}

/**
 * Keep only apps that the user already connected to Market in sync with the
 * explicit ORG2 workspace selection. Unconnected clients are never modified.
 */
export async function syncConnectedExternalMarketApps(
  profile: MarketExecutionProfile,
  preferredAgent: MarketProfileAgent,
  preferredModel: string
) {
  const views = await Promise.allSettled(
    EXTERNAL_MARKET_TARGETS.map(async (target) => ({
      target,
      view: await readTarget(target),
    }))
  );
  const updates = views.flatMap((result) => {
    if (result.status !== "fulfilled") return [];
    const { target, view } = result.value;
    if (
      !isMarketManagedView(view) ||
      !view.installed ||
      !view.config.supported ||
      view.config.conflict
    ) {
      return [];
    }
    const model = modelForExternalTarget(
      profile,
      target,
      preferredAgent,
      preferredModel
    );
    if (!model) return [];
    return [
      configureMarketProfile(
        profile.connection,
        profile.entitlementWorkspaceId,
        profile.entitlementId,
        target,
        model,
        expectedHashes(view)
      ),
    ];
  });
  await Promise.all(updates);
}

/** Restore clients that currently point at a Market selection; leave every
 * other native client configuration untouched. */
export async function restoreConnectedExternalMarketApps() {
  const views = await Promise.allSettled(
    EXTERNAL_MARKET_TARGETS.map(async (target) => ({
      target,
      view: await readTarget(target),
    }))
  );
  await Promise.all(
    views.flatMap((result) => {
      if (
        result.status !== "fulfilled" ||
        !isMarketManagedView(result.value.view)
      ) {
        return [];
      }
      return [
        rpc.agentOrgs.managedConfig.restoreDefault({
          agentName: result.value.target,
          force: false,
        }),
      ];
    })
  );
}
