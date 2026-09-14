import { stat } from "@tauri-apps/plugin-fs";
import { z } from "zod/v4";

import { loadAvailableAgents } from "@src/api/services/availableAgents";
import {
  appendCliCommandArgs,
  cliAgentCreateTuiSession,
  cliAgentTuiRelease,
  deriveExpectedProcess,
  resolveCliTuiCommand,
  withCliCommandEnvironment,
} from "@src/api/tauri/agent/cliTerminalSession";
import { defineProcedure, typedInvoke } from "@src/api/tauri/rpc/invoke";

import { type Connection, loadConfig } from "./rpc";

const launchProfile = defineProcedure("cli_config_prepare_launch")
  .input(
    z.object({
      agentName: z.string(),
      selection: z.string(),
      model: z.string(),
      sessionId: z.string(),
    })
  )
  .output(
    z.object({
      args: z.array(z.string()),
      env: z.record(z.string(), z.string()),
    })
  )
  .build();

export class MarketLaunchError extends Error {
  constructor(public readonly reason: "clientMissing" | "launchFailed") {
    super(reason);
  }
}

/** Prepare an existing ORG2 TUI session without sending a model prompt. */
export async function prepareLaunch(
  connection: Connection,
  selection: string,
  model: string,
  folder: string,
  active: () => boolean
) {
  const platform =
    connection.target === "claude-code"
      ? "claude_code"
      : connection.target === "codex"
        ? "codex"
        : null;
  if (!platform || !selection.startsWith("market:") || !model || !folder)
    throw new MarketLaunchError("launchFailed");
  const checkSelection = async () => {
    const config = await loadConfig(connection);
    if (
      !active() ||
      config.conflict ||
      config.mode !== "orgii_managed" ||
      config.selectedKeyId !== selection ||
      config.selectedModel !== model
    )
      throw new MarketLaunchError("launchFailed");
  };
  const [info, agents] = await Promise.all([
    stat(folder),
    loadAvailableAgents(),
  ]);
  if (!info.isDirectory) throw new MarketLaunchError("launchFailed");
  const agent = agents.find((a) => a.name === platform && a.installed);
  if (!agent?.command.trim()) throw new MarketLaunchError("clientMissing");
  const command = await resolveCliTuiCommand(platform, agent.command.trim());
  if (!command.trim()) throw new MarketLaunchError("launchFailed");
  await checkSelection();
  // Unlike the generic creator's compatibility fallback, a Market launch must
  // have a managed session. Never open an unbound terminal after a failure.
  const created = await cliAgentCreateTuiSession({
    platform,
    name: agent.displayName,
    repoPath: folder,
  });
  try {
    const profile = await typedInvoke(launchProfile, {
      agentName: platform,
      selection,
      model,
      sessionId: created.sessionId,
    });
    await checkSelection();
    const pinnedCommand = appendCliCommandArgs(command, profile.args);
    return {
      cliAgentType: platform as typeof platform,
      command: withCliCommandEnvironment(pinnedCommand, profile.env),
      envOverride: profile.env,
      title: agent.displayName,
      cwd: created.worktreePath || folder,
      agentSessionId: created.sessionId,
      expectedProcess: deriveExpectedProcess(command),
    };
  } catch (error) {
    await cliAgentTuiRelease(created.sessionId);
    throw error;
  }
}
