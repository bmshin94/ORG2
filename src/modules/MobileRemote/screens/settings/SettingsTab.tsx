import React from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { InlineBanner } from "@src/components/InlineBanner";
import { ArrowRight02Icon, HugeiconsIcon } from "@src/icons";
import {
  SECTION_VALUE_SMALL_MUTED_CLASSES,
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";

import { useMobileRemote } from "../../app";
import { MobileTopBar } from "../../components/MobileTopBar";
import { MobileProfileEntry } from "../../components/profile/MobileProfileEntry";
import type { MobilePermissionTier } from "../../connection/types";

function presenceLabel(
  presence: "online" | "offline" | "unknown",
  t: (key: string) => string
): string {
  switch (presence) {
    case "online":
      return t("settings.online");
    case "offline":
      return t("settings.offline");
    default:
      return t("settings.notAvailable");
  }
}

export function resolvePermissionTierLabel(
  tier: MobilePermissionTier | undefined,
  t: (key: string) => string
): string {
  switch (tier) {
    case "full":
      return t("settings.permissionFull");
    case "read_only":
      return t("settings.permissionReadOnly");
    default:
      return t("settings.notAvailable");
  }
}

export interface SettingsTabProps {
  onOpenPairingGuide?: () => void;
  onRevokePairing?: () => void;
}

/** Connection preferences and one entry into the shared account destination. */
export function SettingsTab({
  onOpenPairingGuide,
  onRevokePairing,
}: SettingsTabProps) {
  const { t } = useTranslation("mobileRemote");
  const { connection } = useMobileRemote();

  const desktopValue = connection.desktopName
    ? `${connection.desktopName} · ${presenceLabel(connection.presence, t)}`
    : t("settings.notAvailable");

  return (
    <>
      <MobileTopBar title={t("settings.title")} />
      {connection.demoMode ? (
        <InlineBanner tone="info">{t("settings.demoBanner")}</InlineBanner>
      ) : null}
      <div className="mobile-flow-screen flex-1 px-4 py-4">
        <div className="flex flex-col gap-5">
          <SectionContainer
            title={t("settings.account")}
            dataTestId="mobile-remote-account-settings"
          >
            <SectionRow showHeader={false} className="!py-0">
              <MobileProfileEntry variant="row" />
            </SectionRow>
          </SectionContainer>

          <SectionContainer
            title={t("settings.connection")}
            dataTestId="mobile-remote-connection-settings"
          >
            <SettingsValueRow
              label={t("settings.desktop")}
              value={desktopValue}
            />
          </SectionContainer>

          <SectionContainer
            title={t("settings.authorization")}
            dataTestId="mobile-remote-authorization-settings"
          >
            <SettingsValueRow
              label={t("settings.permissionTier")}
              value={resolvePermissionTierLabel(connection.tier, t)}
            />
            {onRevokePairing ? (
              <SettingsActionRow
                label={t("settings.revokePairing")}
                danger
                onClick={onRevokePairing}
              />
            ) : null}
          </SectionContainer>
          {onOpenPairingGuide ? (
            <SectionContainer
              title={t("settings.help")}
              dataTestId="mobile-remote-help-settings"
            >
              <SettingsActionRow
                label={t("settings.pairingGuide")}
                onClick={onOpenPairingGuide}
              />
            </SectionContainer>
          ) : null}
        </div>
      </div>
    </>
  );
}

SettingsTab.displayName = "SettingsTab";

interface SettingsRowProps {
  label: string;
  value: string;
}

function SettingsValueRow({ label, value }: SettingsRowProps) {
  return (
    <SectionRow label={label} layout="inline" equalColumns>
      <span
        className={`block w-full min-w-0 text-right break-all ${SECTION_VALUE_SMALL_MUTED_CLASSES}`}
        title={value}
      >
        {value}
      </span>
    </SectionRow>
  );
}

interface SettingsActionRowProps {
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

function SettingsActionRow({
  label,
  danger = false,
  disabled,
  onClick,
}: SettingsActionRowProps) {
  return (
    <SectionRow showHeader={false} className="!min-h-0 !py-1.5">
      <Button
        htmlType="button"
        variant={danger ? "danger" : "tertiary"}
        appearance="ghost"
        size="default"
        long
        style={{
          height: "auto",
          minHeight: 44,
          padding: 0,
          whiteSpace: "normal",
        }}
        className="font-normal [&>span]:w-full [&>span]:whitespace-normal"
        onClick={onClick}
        disabled={disabled}
      >
        <span className="flex w-full items-center justify-between gap-3 text-left">
          <span className="min-w-0 break-words">{label}</span>
          {!danger ? (
            <HugeiconsIcon
              icon={ArrowRight02Icon}
              size={16}
              className="shrink-0"
              aria-hidden
            />
          ) : null}
        </span>
      </Button>
    </SectionRow>
  );
}
