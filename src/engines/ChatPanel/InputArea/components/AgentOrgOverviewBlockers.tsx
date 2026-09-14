import React from "react";
import { useTranslation } from "react-i18next";

import type { AgentOrgRunView } from "@src/api/tauri/agent";
import { Alert01Icon, HugeiconsIcon } from "@src/icons";

import { blockerRecoveryCopy } from "./agentOrgOverviewPanelShared";

interface AgentOrgOverviewBlockersProps {
  blockers: AgentOrgRunView["blockers"];
}

const AgentOrgOverviewBlockers: React.FC<AgentOrgOverviewBlockersProps> = ({
  blockers,
}) => {
  const { t } = useTranslation("sessions");
  return (
    <div
      className="space-y-1 rounded-md border border-warning-6/25 bg-warning-6/5 px-2 py-1.5"
      data-testid="agent-org-run-blockers"
    >
      <div className="flex items-center gap-1 text-[11px] font-medium text-warning-6">
        <HugeiconsIcon
          icon={Alert01Icon}
          data-icon="alert"
          size={11}
          strokeWidth={2}
        />
        {t("planner.agentOrgOverview.blockersTitle", {
          defaultValue: "What is still blocking completion",
        })}
      </div>
      {blockers.map((blocker) => (
        <div
          key={`${blocker.kind}:${blocker.recoveryState}:${blocker.reasonCode}`}
          className="flex min-w-0 items-center gap-2 text-[10px] text-text-2"
          data-testid={`agent-org-run-blocker-${blocker.kind}`}
          data-blocker-kind={blocker.kind}
          data-reason-code={blocker.reasonCode}
          data-recovery-state={blocker.recoveryState}
          data-user-action={blocker.userAction}
          data-requires-user-action={blocker.requiresUserAction}
          data-has-more={blocker.hasMore}
          title={blocker.objects
            .map((object) => `${object.displayName} (${object.id})`)
            .join(", ")}
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate">
              {blocker.display ||
                t("planner.agentOrgOverview.unknownBlocker", {
                  defaultValue: "Unknown system blocker",
                })}
            </span>
            <span
              className="block truncate text-[9px] text-text-3"
              data-testid={`agent-org-run-blocker-recovery-${blocker.kind}`}
            >
              {blockerRecoveryCopy(blocker.recoveryState)}
              {blocker.recoveryState === "coordinator_repair_available" &&
              blocker.objects.length > 0
                ? ` · ${blocker.objects
                    .map((object) => object.displayName)
                    .join(", ")}`
                : ""}
            </span>
          </span>
          <span className="shrink-0 tabular-nums">
            {blocker.count}
            {blocker.hasMore ? "+" : ""}
          </span>
        </div>
      ))}
    </div>
  );
};

export default AgentOrgOverviewBlockers;
