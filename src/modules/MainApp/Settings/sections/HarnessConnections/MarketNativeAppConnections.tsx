import { useAtomValue } from "jotai";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { HarnessConnectionView } from "@src/api/tauri/rpc/schemas/agentOrgs";
import Button from "@src/components/Button";
import Message from "@src/components/Message";
import {
  SECTION_DESCRIPTION_CLASSES,
  SectionContainer,
  SectionRow,
} from "@src/components/layout/Section";
import {
  type ExternalMarketTarget,
  configureExternalMarketTarget,
  isMarketManagedView,
  restoreExternalMarketTarget,
} from "@src/features/MarketConnect/externalAppBridge";
import { openConfiguredMarketClient } from "@src/features/MarketConnect/launch";
import {
  type MarketExecutionProfile,
  useMarketExecutionProfiles,
} from "@src/features/MarketConnect/marketProfiles";
import { recentModelEntriesAtom } from "@src/store/session/recentModelEntriesAtom";

import {
  refreshHarnessConnections,
  useHarnessConnection,
} from "./useHarnessConnection";

interface TargetState {
  view: HarnessConnectionView | null;
  error: string | null;
  loading: boolean;
  reload: () => Promise<unknown>;
}

function TargetRow({
  target,
  label,
  currentProfile,
  preferredAgent,
  preferredModel,
  state,
}: {
  target: ExternalMarketTarget;
  label: string;
  currentProfile: MarketExecutionProfile | null;
  preferredAgent?: "claude_code" | "codex";
  preferredModel?: string;
  state: TargetState;
}) {
  const { t } = useTranslation("settings");
  const [busy, setBusy] = useState<"connect" | "open" | "disconnect" | null>(
    null
  );
  const connected = isMarketManagedView(state.view);
  const issue = state.view?.configurationIssue ?? state.view?.config.message;
  const unavailable =
    Boolean(state.view) &&
    (!state.view?.installed || !state.view.config.supported || Boolean(issue));

  const run = async (
    action: "connect" | "open" | "disconnect",
    operation: () => Promise<unknown>
  ) => {
    setBusy(action);
    try {
      await operation();
      await state.reload();
      refreshHarnessConnections();
      Message.success({
        content: t(
          action === "disconnect"
            ? "harnessConnections.marketApps.disconnected"
            : action === "connect"
              ? "harnessConnections.marketApps.connected"
              : "harnessConnections.marketApps.opened"
        ),
      });
    } catch {
      Message.error({
        content: t("harnessConnections.marketApps.actionFailed"),
      });
    } finally {
      setBusy(null);
    }
  };

  const status = state.loading
    ? t("harnessConnections.marketApps.checking")
    : state.error
      ? t("harnessConnections.marketApps.unavailable")
      : !state.view?.installed
        ? t("harnessConnections.marketApps.notInstalled")
        : issue || !state.view.config.supported
          ? t("harnessConnections.marketApps.unavailable")
          : connected
            ? t("harnessConnections.marketApps.following")
            : t("harnessConnections.marketApps.original");

  const connect = () => {
    if (!currentProfile) return;
    run("connect", () =>
      configureExternalMarketTarget(
        currentProfile,
        target,
        preferredAgent,
        preferredModel
      )
    ).catch(() => undefined);
  };

  const open = () => {
    const selection = state.view?.config.selectedKeyId;
    const model = state.view?.config.selectedModel;
    if (!selection || !model) return;
    run("open", () =>
      openConfiguredMarketClient(target, selection, model)
    ).catch(() => undefined);
  };

  const disconnect = () => {
    run("disconnect", () => restoreExternalMarketTarget(target)).catch(
      () => undefined
    );
  };

  return (
    <SectionRow
      label={label}
      description={status}
      align="start"
      dataTestId={`market-native-${target}`}
    >
      <div className="flex flex-wrap justify-end gap-2">
        {!connected ? (
          <Button
            variant="primary"
            size="small"
            loading={busy === "connect"}
            disabled={
              busy !== null ||
              state.loading ||
              Boolean(state.error) ||
              unavailable ||
              currentProfile === null
            }
            onClick={connect}
          >
            {t("harnessConnections.marketApps.connect")}
          </Button>
        ) : (
          <>
            <Button
              size="small"
              loading={busy === "open"}
              disabled={
                busy !== null ||
                unavailable ||
                !state.view?.config.selectedKeyId ||
                !state.view.config.selectedModel
              }
              onClick={open}
            >
              {t("harnessConnections.marketApps.open")}
            </Button>
            <Button
              variant="tertiary"
              appearance="ghost"
              size="small"
              loading={busy === "disconnect"}
              disabled={busy !== null}
              onClick={disconnect}
            >
              {t("harnessConnections.marketApps.disconnect")}
            </Button>
          </>
        )}
      </div>
    </SectionRow>
  );
}

export default function MarketNativeAppConnections() {
  const { t } = useTranslation("settings");
  const recent = useAtomValue(recentModelEntriesAtom);
  const { profiles, loading, error } = useMarketExecutionProfiles({
    enabled: true,
  });
  const claudeCode = useHarnessConnection("claude_code");
  const claudeDesktop = useHarnessConnection("claude_desktop");
  const codex = useHarnessConnection("codex");

  const selected = recent[0]?.marketProfileId ? recent[0] : undefined;
  const currentProfile = selected?.marketProfileId
    ? (profiles.find((profile) => profile.id === selected.marketProfileId) ??
      null)
    : recent.length === 0 && profiles.length === 1
      ? profiles[0]
      : null;
  const preferredAgent =
    selected?.cliAgentType === "claude_code" ||
    selected?.cliAgentType === "codex"
      ? selected.cliAgentType
      : undefined;

  const workspaceStatus = loading
    ? t("harnessConnections.marketApps.loading")
    : error
      ? t("harnessConnections.marketApps.loadFailed")
      : currentProfile
        ? t("harnessConnections.marketApps.currentValue", {
            workspace: currentProfile.label,
            model: selected?.modelId ?? t("harnessConnections.marketApps.auto"),
          })
        : profiles.length > 0
          ? t("harnessConnections.marketApps.chooseInPicker")
          : t("harnessConnections.marketApps.nonePurchased");

  return (
    <div className="flex flex-col gap-4" data-testid="market-native-apps">
      <SectionContainer title={t("harnessConnections.marketApps.workspace")}>
        <SectionRow showHeader={false}>
          <div className="flex w-full flex-col gap-1">
            <p className="text-sm font-medium text-text-1">{workspaceStatus}</p>
            <p className={SECTION_DESCRIPTION_CLASSES}>
              {t("harnessConnections.marketApps.workspaceHelp")}
            </p>
          </div>
        </SectionRow>
      </SectionContainer>

      <SectionContainer title="Claude">
        <SectionRow showHeader={false}>
          <p className={SECTION_DESCRIPTION_CLASSES}>
            {t("harnessConnections.marketApps.claudeHelp")}
          </p>
        </SectionRow>
        <TargetRow
          target="claude_code"
          label="Claude Code"
          currentProfile={currentProfile}
          preferredAgent={preferredAgent}
          preferredModel={selected?.modelId}
          state={claudeCode}
        />
        <TargetRow
          target="claude_desktop"
          label="Claude Desktop"
          currentProfile={currentProfile}
          preferredAgent={preferredAgent}
          preferredModel={selected?.modelId}
          state={claudeDesktop}
        />
      </SectionContainer>

      <SectionContainer title="Codex">
        <TargetRow
          target="codex"
          label="Codex"
          currentProfile={currentProfile}
          preferredAgent={preferredAgent}
          preferredModel={selected?.modelId}
          state={codex}
        />
      </SectionContainer>
    </div>
  );
}
