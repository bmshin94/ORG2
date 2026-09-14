import { open } from "@tauri-apps/plugin-dialog";
import { useSetAtom } from "jotai";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { cliAgentTuiRelease } from "@src/api/tauri/agent/cliTerminalSession";
import Button from "@src/components/Button";
import { ROUTES } from "@src/config/routes";
import { useChatPanelNavigationActions } from "@src/engines/ChatPanel/hooks/useChatPanelNavigationActions";
import { useAppNavigate as useNavigate } from "@src/hooks/navigation/useAppNavigate";
import { addChatPanelTerminalTabAtom } from "@src/store/chatPanel/chatPanelTabsAtom";
import { createChatPanelTerminalAtom } from "@src/store/chatPanel/chatPanelTerminalAtom";

import { MarketLaunchError, prepareLaunch } from "./launch";
import type { Connection } from "./rpc";

export default function WorkspaceLaunch({
  connection,
  selection,
  model,
  onClose,
}: {
  connection: Connection;
  selection: string | null;
  model: string;
  onClose: () => void;
}) {
  const { t } = useTranslation("integrations");
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true),
    running = useRef(false);
  const createTerminal = useSetAtom(createChatPanelTerminalAtom);
  const addTab = useSetAtom(addChatPanelTerminalTabAtom);
  const { showSessionSurface } = useChatPanelNavigationActions();
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const launch = async () => {
    if (running.current || !selection) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      const folder = await open({ directory: true, multiple: false });
      if (!active.current || typeof folder !== "string") return;
      const options = await prepareLaunch(
        connection,
        selection,
        model,
        folder,
        () => active.current
      );
      if (!active.current) {
        await cliAgentTuiRelease(options.agentSessionId);
        return;
      }
      const terminalSessionId = createTerminal({
        name: options.title,
        cwd: options.cwd,
        cliAgentType: options.cliAgentType,
        agentCommand: options.command,
        expectedProcess: options.expectedProcess,
        agentSessionId: options.agentSessionId,
        envOverride: options.envOverride,
      });
      addTab({
        terminalSessionId,
        title: options.title,
        cliCommand: options.command,
      });
      showSessionSurface();
      navigate(ROUTES.workStation.base.path);
      onClose();
    } catch (failure) {
      if (active.current)
        setError(
          failure instanceof MarketLaunchError ? failure.reason : "launchFailed"
        );
    } finally {
      running.current = false;
      if (active.current) setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="primary"
        loading={busy}
        disabled={!selection}
        onClick={() => void launch()}
      >
        {t("marketConnection.openWorkspace")}
      </Button>
      <p className="text-text-2">{t("marketConnection.launchNote")}</p>
      {error && <p role="alert">{t(`marketConnection.${error}`)}</p>}
    </div>
  );
}
