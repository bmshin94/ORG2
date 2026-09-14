import { type Dispatch, type SetStateAction, useCallback } from "react";

import { toMobileRpcError } from "../connection/mobileRpcClient";
import { MobileConnectionAuthorizationError } from "../connection/types";
import type {
  MobileConnectionConfig,
  MobileConnectionState,
} from "../connection/types";
import type { MobileRemotePlatform } from "../platform/types";
import type { useMobileConnectionEstablish } from "./useMobileConnectionEstablish";
import type { MobileConnectionRefs } from "./useMobileConnectionRefs";
import type {
  RemoteReconnectController,
  useMobileConnectionTransport,
} from "./useMobileConnectionTransport";
import type { useMobilePermissions } from "./useMobilePermissions";
import type { useMobileSend } from "./useMobileSend";
import type { useMobileSessionList } from "./useMobileSessionList";
import type { useMobileTranscript } from "./useMobileTranscript";

type TransportApi = ReturnType<typeof useMobileConnectionTransport>;

interface UseMobileConnectionActionsParams {
  platform: MobileRemotePlatform;
  authUserId: string;
  refs: Pick<
    MobileConnectionRefs,
    | "selectionIntentRef"
    | "generationRef"
    | "activeConfigRef"
    | "activeSessionRef"
  >;
  reconnect: RemoteReconnectController;
  setConnection: Dispatch<SetStateAction<MobileConnectionState>>;
  setConnectionConfig: Dispatch<SetStateAction<MobileConnectionConfig | null>>;
  clearReconnectTimer: TransportApi["clearReconnectTimer"];
  releaseTransport: TransportApi["releaseTransport"];
  persistConnection: TransportApi["persistConnection"];
  establishConnection: ReturnType<
    typeof useMobileConnectionEstablish
  >["establishConnection"];
  resetSessions: ReturnType<typeof useMobileSessionList>["resetSessions"];
  resetPermissions: ReturnType<typeof useMobilePermissions>["resetPermissions"];
  resetSend: ReturnType<typeof useMobileSend>["resetSend"];
  resetTranscript: ReturnType<typeof useMobileTranscript>["resetTranscript"];
}

/** User-initiated connection transitions: connect, disconnect, switch desktop. */
export function useMobileConnectionActions({
  platform,
  authUserId,
  refs,
  reconnect,
  setConnection,
  setConnectionConfig,
  clearReconnectTimer,
  releaseTransport,
  persistConnection,
  establishConnection,
  resetSessions,
  resetPermissions,
  resetSend,
  resetTranscript,
}: UseMobileConnectionActionsParams) {
  const {
    selectionIntentRef,
    generationRef,
    activeConfigRef,
    activeSessionRef,
  } = refs;

  const connectLive = useCallback(
    async (config: MobileConnectionConfig) => {
      selectionIntentRef.current += 1;
      generationRef.current += 1;
      const generation = generationRef.current;
      clearReconnectTimer();
      releaseTransport(true);
      reconnect.reset();
      resetSessions();
      resetPermissions();
      resetSend();
      activeConfigRef.current = config;
      setConnectionConfig(config);
      await persistConnection(config);
      if (generation !== generationRef.current) {
        throw new Error("Connection was superseded");
      }
      setConnection((prev) => ({
        ...prev,
        status: "connecting",
        presence: "unknown",
        demoMode: false,
        error: undefined,
      }));
      try {
        await establishConnection(config, generation);
      } catch (error) {
        if (generation === generationRef.current) {
          if (error instanceof MobileConnectionAuthorizationError)
            activeConfigRef.current = null;
          setConnection({
            status: "error",
            presence: "offline",
            demoMode: false,
            error: toMobileRpcError(error),
          });
        }
        throw error;
      }
    },
    [
      clearReconnectTimer,
      reconnect,
      establishConnection,
      persistConnection,
      releaseTransport,
      resetSessions,
      resetPermissions,
      resetSend,
      activeConfigRef,
      generationRef,
      selectionIntentRef,
      setConnection,
      setConnectionConfig,
    ]
  );

  const disconnect = useCallback(async () => {
    selectionIntentRef.current += 1;
    generationRef.current += 1;
    clearReconnectTimer();
    activeConfigRef.current = null;
    setConnectionConfig(null);
    releaseTransport(true);
    activeSessionRef.current = null;
    setConnection({
      status: "disconnected",
      presence: "unknown",
      demoMode: false,
    });
    resetSessions();
    resetTranscript();
    resetSend();
    resetPermissions();
    await persistConnection(null);
  }, [
    resetTranscript,
    clearReconnectTimer,
    persistConnection,
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

  const switchPairedDesktop = useCallback(
    async (desktopId: string) => {
      const selectionIntent = ++selectionIntentRef.current;
      const config = await platform.connection.selectPairedDesktop(
        authUserId,
        desktopId
      );
      if (selectionIntent !== selectionIntentRef.current) return;
      if (!config) throw new Error("Paired desktop is unavailable");
      await connectLive(config);
    },
    [authUserId, connectLive, platform.connection, selectionIntentRef]
  );

  return { connectLive, disconnect, switchPairedDesktop };
}
