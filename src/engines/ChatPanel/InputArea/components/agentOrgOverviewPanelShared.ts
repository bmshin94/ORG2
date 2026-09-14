import type {
  AgentOrgTask,
  AgentOrgTaskExecutionHandoffReceipt,
  AgentOrgTaskExecutionHandoffResolution,
} from "@src/api/tauri/agent";
import { createLogger } from "@src/hooks/logger";

export const logger = createLogger("AgentOrgOverviewPanel");

export function reportUnexpectedHistoryLoadError(error: unknown): void {
  logger.error("Unexpected Agent Team Task history failure:", error);
}

// Keep the opposite control disabled briefly after Pause/Resume settles. The
// two controls occupy the same toolbar position, so the second click of a
// double-click can otherwise land on the newly rendered inverse action.
export const PAUSE_TOGGLE_GESTURE_COOLDOWN_MS = 500;

const BLOCKER_RECOVERY_COPY: Record<string, string> = {
  waiting_for_runtime: "Waiting for the running Team to continue",
  system_repairing: "System recovery is in progress",
  coordinator_repair_available:
    "The Coordinator can inspect and safely repair this Inbox item",
  system_attention_required: "System attention is required",
  user_action_required: "Your decision is required",
};

export const blockerRecoveryCopy = (recoveryState: string): string =>
  BLOCKER_RECOVERY_COPY[recoveryState] ??
  BLOCKER_RECOVERY_COPY.system_attention_required;

export interface TaskActionDialogState {
  task: AgentOrgTask;
  action: "cancel" | "reassign";
}

export interface HandoffResolutionDialogState {
  receipt: AgentOrgTaskExecutionHandoffReceipt;
  resolution: AgentOrgTaskExecutionHandoffResolution;
}
