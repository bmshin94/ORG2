import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
} from "react";

import type { createRemoteReconnectController } from "../connection/remoteReconnectController";
import type {
  MobileConnectionConfig,
  MobileConnectionState,
  MobilePairedDesktopSummary,
} from "../connection/types";
import { DEMO_DESKTOP_NAME, DEMO_SESSIONS } from "../demo/demoFixtures";
import type { MobileRemotePlatform } from "../platform/types";
import type { MobileConnectionRefs } from "./useMobileConnectionRefs";
import type { useMobilePermissions } from "./useMobilePermissions";
import type { useMobileSend } from "./useMobileSend";
import type { useMobileSessionList } from "./useMobileSessionList";
import type { useMobileTranscript } from "./useMobileTranscript";

type TranscriptApi = ReturnType<typeof useMobileTranscript>;
type SessionListApi = ReturnType<typeof useMobileSessionList>;
export type RemoteReconnectController = ReturnType<
  typeof createRemoteReconnectController
>;

interface UseMobileConnectionTransportParams {
  platform: MobileRemotePlatform;
  authUserId: string;
  refs: MobileConnectionRefs;
  reconnect: RemoteReconnectController;
  setConnection: Dispatch<SetStateAction<MobileConnectionState>>;
  setConnectionConfig: Dispatch<SetStateAction<MobileConnectionConfig | null>>;
  setPairedDesktops: Dispatch<SetStateAction<MobilePairedDesktopSummary[]>>;
  invalidateTranscriptRequests: TranscriptApi["invalidateTranscriptRequests"];
  showDemoTranscript: TranscriptApi["showDemoTranscript"];
  resetSessions: SessionListApi["resetSessions"];
  resetSend: ReturnType<typeof useMobileSend>["resetSend"];
  resetPermissions: ReturnType<typeof useMobilePermissions>["resetPermissions"];
}

/** Socket lifecycle: persist config, release transport, demo mode, visibility. */
export function useMobileConnectionTransport({
  platform,
  authUserId,
  refs,
  reconnect,
  setConnection,
  setConnectionConfig,
  setPairedDesktops,
  invalidateTranscriptRequests,
  showDemoTranscript,
  resetSessions,
  resetSend,
  resetPermissions,
}: UseMobileConnectionTransportParams) {
  const {
    preparationRef,
    clientRef,
    socketRef,
    activeSessionRef,
    unsubscribeRpcRef,
    activeConfigRef,
    generationRef,
    selectionIntentRef,
    connectionWriteChainRef,
  } = refs;

  const persistConnection = useCallback(
    (config: MobileConnectionConfig | null) => {
      const operation = connectionWriteChainRef.current.then(async () => {
        await platform.connection.save(authUserId, config);
        setPairedDesktops(
          await platform.connection.listPairedDesktops(authUserId)
        );
      });
      connectionWriteChainRef.current = operation.catch(() => undefined);
      return operation;
    },
    [
      authUserId,
      connectionWriteChainRef,
      platform.connection,
      setPairedDesktops,
    ]
  );

  const clearReconnectTimer = useCallback(() => reconnect.clear(), [reconnect]);

  const releaseTransport = useCallback(
    (close: boolean) => {
      reconnect.invalidate();
      preparationRef.current?.abort();
      preparationRef.current = null;
      // Invalidate every in-flight subscribe/refresh from the old socket before
      // it can reject or resolve into the retained logical session state.
      invalidateTranscriptRequests();
      unsubscribeRpcRef.current?.();
      unsubscribeRpcRef.current = null;
      const client = clientRef.current;
      clientRef.current = null;
      const socket = socketRef.current;
      socketRef.current = null;
      if (close) {
        if (client) client.close();
        else socket?.close();
      }
    },
    [
      reconnect,
      invalidateTranscriptRequests,
      clientRef,
      preparationRef,
      socketRef,
      unsubscribeRpcRef,
    ]
  );

  const enterDemoMode = useCallback(() => {
    selectionIntentRef.current += 1;
    generationRef.current += 1;
    clearReconnectTimer();
    activeConfigRef.current = null;
    setConnectionConfig(null);
    releaseTransport(true);
    setConnection({
      status: "connected",
      presence: "online",
      desktopName: DEMO_DESKTOP_NAME,
      tier: "full",
      capabilities: { roundHistory: true, openSessionFile: false },
      demoMode: true,
    });
    resetSessions(DEMO_SESSIONS);
    showDemoTranscript(activeSessionRef.current ?? "demo");
    resetSend();
    resetPermissions();
  }, [
    showDemoTranscript,
    clearReconnectTimer,
    releaseTransport,
    resetSessions,
    resetPermissions,
    resetSend,
    activeConfigRef,
    activeSessionRef,
    generationRef,
    selectionIntentRef,
    setConnection,
    setConnectionConfig,
  ]);

  useEffect(() => {
    const handleVisible = () => {
      const config = activeConfigRef.current;
      clearReconnectTimer();
      if (platform.runtime.isHidden()) {
        preparationRef.current?.abort();
        if (clientRef.current || socketRef.current) {
          releaseTransport(true);
          setConnection((previous) => ({
            ...previous,
            status: "connecting",
            presence: "offline",
            error: undefined,
          }));
        }
        return;
      }
      if (config && !clientRef.current) {
        void reconnect
          .run(config, generationRef.current)
          .catch(() => undefined);
      }
    };
    return platform.runtime.subscribeVisibility(handleVisible);
  }, [
    clearReconnectTimer,
    platform.runtime,
    releaseTransport,
    reconnect,
    activeConfigRef,
    clientRef,
    generationRef,
    preparationRef,
    setConnection,
    socketRef,
  ]);

  return {
    persistConnection,
    clearReconnectTimer,
    releaseTransport,
    enterDemoMode,
  };
}
