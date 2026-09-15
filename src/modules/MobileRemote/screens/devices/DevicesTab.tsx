import React from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import PageNotice from "@src/components/PageNotice";
import { Placeholder } from "@src/components/Placeholder";
import StatusDot from "@src/components/StatusDot";
import { HugeiconsIcon, LaptopIcon, SmartPhone01Icon } from "@src/icons";
import {
  SECTION_VALUE_SMALL_MUTED_CLASSES,
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";

import { useMobileRemote } from "../../app";
import { MobileTopBar } from "../../components/MobileTopBar";
import { derivePairedDesktopPresence } from "../../connection/mobilePairedDesktopPresence";
import type { DesktopPresence } from "../../connection/types";

function resolveDotColor(presence: DesktopPresence): string {
  switch (presence) {
    case "online":
      return "bg-success-6";
    case "offline":
      return "bg-text-4";
    default:
      return "bg-text-4";
  }
}

function resolvePresenceLabel(
  presence: DesktopPresence,
  t: (key: string) => string
): string {
  switch (presence) {
    case "online":
      return t("devices.online");
    case "offline":
      return t("devices.offline");
    default:
      return t("devices.unknown");
  }
}

/** M-16 Devices — local device stub + paired desktop list from connection context. */
export function DevicesTab() {
  const { t } = useTranslation("mobileRemote");
  const [switchingDesktopId, setSwitchingDesktopId] = React.useState<
    string | null
  >(null);
  const [switchError, setSwitchError] = React.useState<string | null>(null);
  const {
    connection,
    pairedDesktops: pairedDesktopInventory,
    switchPairedDesktop,
  } = useMobileRemote();
  const pairedDesktops = derivePairedDesktopPresence({
    desktops: pairedDesktopInventory,
    activePresence: connection.presence,
  });

  return (
    <>
      <MobileTopBar title={t("devices.title")} />
      <div className="mobile-flow-screen flex-1 px-4 py-4">
        <div className="flex flex-col gap-5">
          <SectionContainer
            title={t("devices.thisDevice")}
            dataTestId="mobile-remote-this-device"
          >
            <SectionRow
              layout="inline"
              label={
                <span className="flex min-w-0 items-center gap-2">
                  <HugeiconsIcon
                    icon={SmartPhone01Icon}
                    size={16}
                    className="shrink-0 text-text-3"
                    aria-hidden="true"
                  />
                  <span className="truncate">
                    {t("devices.thisDeviceLabel")}
                  </span>
                </span>
              }
            >
              <span
                className={`block max-w-full min-w-0 truncate text-right ${SECTION_VALUE_SMALL_MUTED_CLASSES}`}
              >
                {t("devices.thisDeviceSubtitle")}
              </span>
            </SectionRow>
          </SectionContainer>

          <SectionContainer
            title={t("devices.pairedDesktops")}
            padding={pairedDesktops.length === 0 ? "default" : "none"}
            dataTestId="mobile-remote-paired-desktops"
          >
            {pairedDesktops.length === 0 ? (
              <Placeholder
                variant="empty"
                title={t("devices.emptyDesktops")}
                className="py-6"
              />
            ) : (
              <>
                {pairedDesktops.map((desktop) => (
                  <SectionRow
                    key={desktop.id}
                    layout="inline"
                    className="py-1"
                    label={
                      desktop.current ? (
                        <span
                          aria-current="true"
                          className="flex min-h-11 min-w-0 items-center gap-2 text-text-1"
                        >
                          <HugeiconsIcon
                            icon={LaptopIcon}
                            size={16}
                            className="shrink-0 text-text-3"
                            aria-hidden="true"
                          />
                          <span className="flex min-w-0 flex-1 flex-col gap-1">
                            <span className="break-words">{desktop.name}</span>
                            {desktop.details ? (
                              <span
                                className={`font-normal break-words ${SECTION_VALUE_SMALL_MUTED_CLASSES}`}
                              >
                                {desktop.details}
                              </span>
                            ) : null}
                            <span
                              className={`font-normal ${SECTION_VALUE_SMALL_MUTED_CLASSES}`}
                            >
                              {t("devices.currentDesktop")}
                            </span>
                          </span>
                        </span>
                      ) : (
                        <Button
                          variant="tertiary"
                          appearance="ghost"
                          long
                          className="min-w-0 justify-start text-left disabled:cursor-default"
                          style={{
                            height: "auto",
                            minHeight: 44,
                            padding: "8px 0",
                          }}
                          disabled={switchingDesktopId !== null}
                          loading={switchingDesktopId === desktop.id}
                          aria-busy={switchingDesktopId === desktop.id}
                          aria-label={t("devices.switchTo", {
                            name: desktop.name,
                          })}
                          icon={
                            <HugeiconsIcon
                              icon={LaptopIcon}
                              size={16}
                              className="shrink-0 text-text-3"
                              aria-hidden="true"
                            />
                          }
                          onClick={async () => {
                            setSwitchError(null);
                            setSwitchingDesktopId(desktop.id);
                            try {
                              await switchPairedDesktop(desktop.id);
                            } catch {
                              setSwitchError(t("devices.switchFailed"));
                            } finally {
                              setSwitchingDesktopId(null);
                            }
                          }}
                        >
                          <span className="flex min-w-0 flex-1 flex-col gap-1 whitespace-normal">
                            <span className="break-words">{desktop.name}</span>
                            {desktop.details ? (
                              <span
                                className={`font-normal break-words ${SECTION_VALUE_SMALL_MUTED_CLASSES}`}
                              >
                                {desktop.details}
                              </span>
                            ) : null}
                          </span>
                        </Button>
                      )
                    }
                  >
                    <StatusDot
                      color={resolveDotColor(desktop.presence)}
                      label={
                        desktop.current
                          ? resolvePresenceLabel(desktop.presence, t)
                          : t("devices.presenceUnknown")
                      }
                      size="inline"
                    />
                  </SectionRow>
                ))}
                {switchError ? (
                  <SectionRow showHeader={false} compact>
                    <PageNotice
                      type="danger"
                      role="alert"
                      compact
                      className="w-full"
                    >
                      {switchError}
                    </PageNotice>
                  </SectionRow>
                ) : null}
              </>
            )}
          </SectionContainer>
        </div>
      </div>
    </>
  );
}

DevicesTab.displayName = "DevicesTab";
