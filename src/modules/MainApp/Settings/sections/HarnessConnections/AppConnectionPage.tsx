import { useAtomValue } from "jotai";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { rpc } from "@src/api/tauri/rpc";
import type { ConnectionHarness } from "@src/api/tauri/rpc/schemas/agentOrgs";
import Button from "@src/components/Button";
import Message from "@src/components/Message";
import {
  SECTION_DESCRIPTION_CLASSES,
  SectionContainer,
  SectionRow,
} from "@src/components/layout/Section";
import {
  configureExternalMarketTarget,
  isMarketManagedView,
  restoreExternalMarketTarget,
} from "@src/features/MarketConnect/externalAppBridge";
import { openConfiguredMarketClient } from "@src/features/MarketConnect/launch";
import {
  type MarketExecutionProfile,
  type MarketProfileAgent,
  useMarketExecutionProfiles,
} from "@src/features/MarketConnect/marketProfiles";
import { profileForAppliedMarketSelection } from "@src/features/MarketConnect/marketSelection";
import { recentModelEntriesAtom } from "@src/store/session/recentModelEntriesAtom";

import {
  refreshHarnessConnections,
  useHarnessConnection,
} from "./useHarnessConnection";

type PickerStep = "closed" | "provider" | "market" | "accounts";

const agentFor = (target: ConnectionHarness): MarketProfileAgent =>
  target === "codex" ? "codex" : "claude_code";

function profileLabel(
  profile: MarketExecutionProfile,
  profiles: MarketExecutionProfile[],
  suffix: (index: number, count: number) => string
) {
  const matches = profiles.filter((item) => item.label === profile.label);
  if (matches.length < 2) return profile.label;
  return `${profile.label} · ${suffix(
    matches.findIndex((item) => item.id === profile.id) + 1,
    matches.length
  )}`;
}

export default function AppConnectionPage({
  target,
  onConfigureAccounts,
}: {
  target: ConnectionHarness;
  onConfigureAccounts: () => void;
}) {
  const { t } = useTranslation("settings");
  const recent = useAtomValue(recentModelEntriesAtom);
  const {
    profiles,
    loading: profilesLoading,
    error: profilesError,
  } = useMarketExecutionProfiles({ enabled: true });
  const state = useHarnessConnection(target);
  const [picker, setPicker] = useState<PickerStep>("closed");
  const [busy, setBusy] = useState<"connect" | "open" | "restore" | null>(null);
  const [chosenProfile, setChosenProfile] =
    useState<MarketExecutionProfile | null>(null);
  const agent = agentFor(target);
  const marketProfiles = useMemo(
    () => profiles.filter((profile) => profile.modelsByAgent[agent].length > 0),
    [agent, profiles]
  );
  const appliedMarketProfile = profileForAppliedMarketSelection(
    profiles,
    state.view?.config.selectedKeyId
  );
  const activeMarketProfile = appliedMarketProfile ?? chosenProfile;
  const marketManaged = isMarketManagedView(state.view);
  const configured = Boolean(
    state.view && state.view.config.mode !== "default"
  );
  const accountName =
    state.view?.choices.find(
      (choice) => choice.keyId === state.view?.config.selectedKeyId
    )?.name ?? null;
  const activeMarketName = activeMarketProfile
    ? profileLabel(activeMarketProfile, marketProfiles, (index, count) =>
        t("harnessConnections.marketApps.workspaceNumber", { index, count })
      )
    : null;
  const currentName = marketManaged
    ? (activeMarketName ?? t("harnessConnections.marketApps.workspace"))
    : (accountName ?? t("harnessConnections.original"));
  const issue =
    state.error ??
    state.view?.configurationIssue ??
    state.view?.config.message ??
    null;
  const unavailable = Boolean(
    !state.view?.installed ||
    !state.view?.config.supported ||
    state.view?.config.conflict ||
    issue
  );

  const refresh = async () => {
    refreshHarnessConnections();
    await state.reload();
  };
  const connectMarket = async (profile: MarketExecutionProfile) => {
    setChosenProfile(profile);
    setBusy("connect");
    try {
      const selected = recent.find(
        (entry) => entry.marketProfileId === profile.id
      );
      await configureExternalMarketTarget(
        profile,
        target,
        selected?.cliAgentType === "claude_code" ||
          selected?.cliAgentType === "codex"
          ? selected.cliAgentType
          : undefined,
        selected?.modelId
      );
      setPicker("closed");
      await refresh();
      Message.success({
        content: t("harnessConnections.marketApps.connected"),
      });
    } catch {
      Message.error({
        content: t("harnessConnections.marketApps.actionFailed"),
      });
    } finally {
      setBusy(null);
    }
  };
  const openClient = async () => {
    const selection = state.view?.config.selectedKeyId;
    const model = state.view?.config.selectedModel;
    if (!selection || !model) return;
    setBusy("open");
    try {
      await openConfiguredMarketClient(target, selection, model);
      Message.success({
        content: t(
          target === "claude_code"
            ? "harnessConnections.marketApps.terminalOpened"
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
  const restore = async () => {
    setBusy("restore");
    try {
      if (marketManaged) {
        await restoreExternalMarketTarget(target);
      } else {
        await rpc.agentOrgs.managedConfig.restoreDefault({
          agentName: target,
          force: false,
        });
      }
      setChosenProfile(null);
      await refresh();
      Message.success({
        content: t("harnessConnections.marketApps.disconnected"),
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
    : !state.view?.installed
      ? t("harnessConnections.marketApps.notInstalled")
      : unavailable
        ? t("harnessConnections.marketApps.unavailable")
        : marketManaged
          ? t("harnessConnections.proxyHelp")
          : configured
            ? t("harnessConnections.applied")
            : t("harnessConnections.marketApps.original");
  const duplicateCounts = useMemo(() => {
    const counts = new Map<string, number>();
    marketProfiles.forEach((profile) =>
      counts.set(profile.label, (counts.get(profile.label) ?? 0) + 1)
    );
    return counts;
  }, [marketProfiles]);
  const positions = new Map<string, number>();

  return (
    <div className="flex flex-col gap-4" data-testid={`app-page-${target}`}>
      <SectionContainer title={t("harnessConnections.current")}>
        <SectionRow showHeader={false}>
          <div className="flex w-full flex-col gap-1">
            <span className="truncate text-base font-medium text-text-1">
              {currentName}
            </span>
            {configured && (
              <span className="text-xs text-text-2">
                {t(
                  marketManaged
                    ? "harnessConnections.marketApps.workspace"
                    : "harnessConnections.connection"
                )}
              </span>
            )}
            <span className={SECTION_DESCRIPTION_CLASSES}>{status}</span>
            {issue && <span className="text-sm text-warning-6">{issue}</span>}
          </div>
        </SectionRow>
        <SectionRow showHeader={false}>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy !== null || state.loading}
              onClick={() =>
                setPicker((value) =>
                  value === "closed" ? "provider" : "closed"
                )
              }
            >
              {t(configured ? "common:actions.edit" : "common:actions.select")}
            </Button>
            {marketManaged && (
              <Button
                variant="secondary"
                loading={busy === "open"}
                disabled={busy !== null || unavailable}
                onClick={() => void openClient()}
              >
                {t(
                  target === "claude_code"
                    ? "harnessConnections.marketApps.openTerminal"
                    : "harnessConnections.marketApps.open"
                )}
              </Button>
            )}
            {configured && (
              <Button
                variant="secondary"
                loading={busy === "restore"}
                disabled={busy !== null || unavailable}
                onClick={() => void restore()}
              >
                {t("harnessConnections.restore")}
              </Button>
            )}
          </div>
        </SectionRow>
      </SectionContainer>

      {picker !== "closed" && (
        <SectionContainer
          title={t(
            picker === "provider"
              ? "common:labels.provider"
              : "harnessConnections.connection"
          )}
          dataTestId="connection-picker"
        >
          {picker !== "provider" && (
            <SectionRow showHeader={false}>
              <Button
                variant="tertiary"
                appearance="ghost"
                size="small"
                onClick={() => setPicker("provider")}
              >
                {t("common:actions.back")}
              </Button>
            </SectionRow>
          )}
          {picker === "provider" && (
            <SectionRow showHeader={false}>
              <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
                <ProviderButton
                  title={t("harnessConnections.marketApps.workspace")}
                  detail={t("harnessConnections.marketApps.workspaceHelp")}
                  onClick={() => setPicker("market")}
                />
                <ProviderButton
                  title={t("harnessConnections.connection")}
                  detail={t("harnessConnections.empty")}
                  onClick={() => setPicker("accounts")}
                />
              </div>
            </SectionRow>
          )}
          {picker === "market" && (
            <SectionRow showHeader={false}>
              <div className="flex w-full flex-col gap-2">
                {profilesLoading ? (
                  <p className={SECTION_DESCRIPTION_CLASSES}>
                    {t("harnessConnections.marketApps.loading")}
                  </p>
                ) : profilesError ? (
                  <p className="text-sm text-warning-6">
                    {t("harnessConnections.marketApps.loadFailed")}
                  </p>
                ) : marketProfiles.length === 0 ? (
                  <p className={SECTION_DESCRIPTION_CLASSES}>
                    {t("harnessConnections.marketApps.nonePurchased")}
                  </p>
                ) : (
                  marketProfiles.map((profile) => {
                    const position = (positions.get(profile.label) ?? 0) + 1;
                    positions.set(profile.label, position);
                    const count = duplicateCounts.get(profile.label) ?? 1;
                    const title =
                      count > 1
                        ? `${profile.label} · ${t("harnessConnections.marketApps.workspaceNumber", { index: position, count })}`
                        : profile.label;
                    return (
                      <ConnectionChoiceButton
                        key={profile.id}
                        title={title}
                        detail={`${profile.modelsByAgent[agent].length} · ${t(
                          "harnessConnections.model"
                        )}`}
                        loading={
                          busy === "connect" && chosenProfile?.id === profile.id
                        }
                        disabled={busy !== null || unavailable}
                        testId={`market-connection-${profile.entitlementId}`}
                        onClick={() => void connectMarket(profile)}
                      />
                    );
                  })
                )}
              </div>
            </SectionRow>
          )}
          {picker === "accounts" && (
            <SectionRow showHeader={false}>
              <div className="flex w-full flex-col gap-2">
                {(state.view?.choices ?? []).map((choice) => (
                  <ConnectionChoiceButton
                    key={choice.keyId}
                    title={choice.name}
                    detail={choice.reason ?? t("harnessConnections.advanced")}
                    disabled={Boolean(choice.reason)}
                    onClick={onConfigureAccounts}
                  />
                ))}
                {!state.view?.choices.length && (
                  <p className={SECTION_DESCRIPTION_CLASSES}>
                    {t("harnessConnections.empty")}
                  </p>
                )}
              </div>
            </SectionRow>
          )}
        </SectionContainer>
      )}
    </div>
  );
}

function ProviderButton({
  title,
  detail,
  onClick,
}: {
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <ConnectionChoiceButton title={title} detail={detail} onClick={onClick} />
  );
}

function ConnectionChoiceButton({
  title,
  detail,
  testId,
  disabled,
  loading,
  onClick,
}: {
  title: string;
  detail: string;
  testId?: string;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="secondary"
      appearance="outline"
      className="h-auto min-w-0 justify-start p-3 text-left"
      data-testid={testId}
      disabled={disabled}
      loading={loading}
      onClick={onClick}
    >
      <span className="flex min-w-0 flex-col gap-1">
        <span className="font-medium">{title}</span>
        <span className="text-xs text-text-2">{detail}</span>
      </span>
    </Button>
  );
}
