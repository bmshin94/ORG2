import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { MobileAuthContext } from "../auth/MobileAuthContext";
import type { MobileRpcClient } from "../connection/mobileRpcClient";
import { createRemoteReconnectController } from "../connection/remoteReconnectController";
import type {
  MobileConnectionConfig,
  MobileConnectionState,
  MobilePairedDesktopSummary,
} from "../connection/types";
import { DEMO_PERMISSION_REQUEST } from "../demo/demoFixtures";
import { useMobileRemotePlatform } from "../platform";
import {
  MobileRemoteContext,
  type MobileRemoteContextValue,
} from "./MobileRemoteContext";
import { useMobileConnectionActions } from "./useMobileConnectionActions";
import { useMobileConnectionEstablish } from "./useMobileConnectionEstablish";
import { useMobileConnectionRefs } from "./useMobileConnectionRefs";
import { useMobileConnectionTransport } from "./useMobileConnectionTransport";
import { useMobilePermissions } from "./useMobilePermissions";
import { useMobileRpcNotifications } from "./useMobileRpcNotifications";
import { useMobileSend } from "./useMobileSend";
import { useMobileSessionActions } from "./useMobileSessionActions";
import { useMobileSessionList } from "./useMobileSessionList";
import { useMobileSessionModel } from "./useMobileSessionModel";
import { useMobileTranscript } from "./useMobileTranscript";

export type { MobileRemoteContextValue } from "./MobileRemoteContext";
export { useMobileRemote } from "./MobileRemoteContext";
export type { MobileSendStatus } from "./useMobileSend";

export interface MobileRemoteProvidersProps {
  children: React.ReactNode;
  /** Authenticated ORG2 Cloud subject; scopes all retained pairing state. */
  authUserId: string;
  relayUrl?: string;
  demoByDefault?: boolean;
  /** A freshly scanned QR must take precedence over a stored old desktop. */
  suppressInitialBootstrap?: boolean;
}

export function MobileRemoteProviders({
  children,
  authUserId,
  relayUrl,
  demoByDefault = true,
  suppressInitialBootstrap = false,
}: MobileRemoteProvidersProps) {
  const platform = useMobileRemotePlatform();
  const auth = useContext(MobileAuthContext);
  const authRef = useRef(auth);
  authRef.current = auth;
  const refs = useMobileConnectionRefs();
  const {
    clientRef,
    activeSessionRef,
    generationRef,
    selectionIntentRef,
    recoverRef,
    scheduleReconnectRef,
  } = refs;
  const reconnect = useMemo(
    () =>
      createRemoteReconnectController(
        platform.runtime,
        (generation) => generation === generationRef.current,
        (config, generation) => recoverRef.current(config, generation)
      ),
    [platform.runtime, generationRef, recoverRef]
  );

  const [connection, setConnection] = useState<MobileConnectionState>({
    status: "disconnected",
    presence: "unknown",
    demoMode: demoByDefault && !suppressInitialBootstrap,
  });
  const [connectionConfig, setConnectionConfig] =
    useState<MobileConnectionConfig | null>(null);
  const [pairedDesktops, setPairedDesktops] = useState<
    MobilePairedDesktopSummary[]
  >([]);
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const { sessions, sessionsHasMore, requestSessionList, resetSessions } =
    useMobileSessionList(clientRef);
  const {
    transcript,
    setTranscript,
    transcriptView,
    beginLoad,
    resetTranscript,
    showDemoTranscript,
    failLoad,
    invalidateTranscriptRequests,
    requestSessionSnapshot,
    refreshSubscribedSession,
    receiveSnapshot,
    selectRound,
    retrySelectedRound,
  } = useMobileTranscript({
    clientRef,
    connectionRef,
    activeSessionRef,
    connection,
  });
  const requireWritableClient = useCallback((): MobileRpcClient => {
    const client = clientRef.current;
    if (
      !client ||
      connection.status !== "connected" ||
      connection.presence !== "online"
    ) {
      throw new Error("Desktop is offline");
    }
    if (connection.tier === "read_only") {
      throw new Error("This device has read-only access");
    }
    return client;
  }, [connection.presence, connection.status, connection.tier, clientRef]);

  const {
    activePermission,
    permissionQueueDepth,
    permissionSubmitting,
    respondPermission,
    dismissPermissionHead,
    resetPermissions,
    receivePermissionEvent,
  } = useMobilePermissions({
    sessionId: transcript.sessionId,
    demoMode: connection.demoMode,
    requireWritableClient,
  });

  const {
    sessionModel,
    refreshSessionModel,
    setSessionModel,
    resetSessionModel,
  } = useMobileSessionModel({
    clientRef,
    connectionRef,
    activeSessionRef,
    requireWritableClient,
  });

  const onDemoSend = useCallback(
    (sessionId: string) =>
      resetPermissions([{ ...DEMO_PERMISSION_REQUEST, sessionId }]),
    [resetPermissions]
  );
  const {
    sendStatus,
    resetSend,
    receiveTerminal,
    receiveSendStatus,
    sendMessage,
  } = useMobileSend({
    demoMode: connection.demoMode,
    runtime: platform.runtime,
    model: sessionModel.config?.model,
    requireWritableClient,
    setTranscript,
    onDemoSend,
  });

  const handleRpcNotification = useMobileRpcNotifications({
    refs,
    setConnection,
    requestSessionList,
    receivePermissionEvent,
    receiveTerminal,
    receiveSendStatus,
    receiveSnapshot,
    refreshSubscribedSession,
  });

  const {
    persistConnection,
    clearReconnectTimer,
    releaseTransport,
    enterDemoMode,
  } = useMobileConnectionTransport({
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
  });

  const { establishConnection, runReconnect } = useMobileConnectionEstablish({
    platform,
    authUserId,
    authRef,
    refs,
    reconnect,
    setConnection,
    releaseTransport,
    handleRpcNotification,
    requestSessionList,
    requestSessionSnapshot,
    beginLoad,
  });

  recoverRef.current = runReconnect;
  scheduleReconnectRef.current = reconnect.schedule;

  const { connectLive, disconnect, switchPairedDesktop } =
    useMobileConnectionActions({
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
    });

  const {
    refreshSessions,
    loadMoreSessions,
    subscribeSession,
    unsubscribeSession,
    openSessionFileInDesktop,
    stopSession,
  } = useMobileSessionActions({
    connection,
    connectionRef,
    refs,
    sessionsHasMore,
    requireWritableClient,
    requestSessionList,
    resetSessions,
    resetSend,
    beginLoad,
    failLoad,
    showDemoTranscript,
    requestSessionSnapshot,
    resetTranscript,
    refreshSessionModel,
    resetSessionModel,
  });

  useEffect(() => {
    if (suppressInitialBootstrap) {
      return () => {
        selectionIntentRef.current += 1;
        generationRef.current += 1;
        clearReconnectTimer();
        releaseTransport(true);
      };
    }
    let disposed = false;
    const bootstrapGeneration = generationRef.current;
    void (async () => {
      const inventoryPromise =
        platform.connection.listPairedDesktops(authUserId);
      const config = relayUrl?.trim()
        ? { wsUrl: relayUrl.trim() }
        : await platform.connection.load(authUserId);
      const inventory = await inventoryPromise;
      if (disposed || bootstrapGeneration !== generationRef.current) {
        return;
      }
      setPairedDesktops(inventory);
      setConnectionConfig(config);
      if (config?.wsUrl || config?.host) {
        await connectLive(config).catch(() => undefined);
      } else if (demoByDefault) {
        enterDemoMode();
      }
    })();
    return () => {
      disposed = true;
      selectionIntentRef.current += 1;
      generationRef.current += 1;
      clearReconnectTimer();
      releaseTransport(true);
    };
    // Mount-only bootstrap; callbacks are stable over the provider lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<MobileRemoteContextValue>(
    () => ({
      connection,
      sessions,
      transcriptItems: transcriptView.items,
      transcriptPhase: transcriptView.phase,
      transcriptError: transcriptView.error,
      transcriptTruncated: transcriptView.truncated,
      transcriptRounds: transcript.rounds,
      transcriptRoundsComplete: transcript.roundsComplete,
      selectedRoundId: transcript.selectedRoundId,
      activeRoundId: transcriptView.roundId,
      sendStatus,
      activePermission,
      permissionQueueDepth,
      permissionSubmitting,
      rpc: clientRef.current,
      connectionConfig,
      pairedDesktops,
      connectLive,
      switchPairedDesktop,
      enterDemoMode,
      disconnect,
      refreshSessions,
      loadMoreSessions,
      sessionsHasMore,
      subscribeSession,
      unsubscribeSession,
      selectRound,
      retrySelectedRound,
      sendMessage,
      openSessionFileInDesktop,
      respondPermission,
      dismissPermissionHead,
      stopSession,
      sessionModel,
      refreshSessionModel,
      setSessionModel,
    }),
    [
      activePermission,
      connectLive,
      connectionConfig,
      connection,
      dismissPermissionHead,
      disconnect,
      enterDemoMode,
      permissionQueueDepth,
      permissionSubmitting,
      refreshSessionModel,
      refreshSessions,
      loadMoreSessions,
      sessionsHasMore,
      openSessionFileInDesktop,
      pairedDesktops,
      respondPermission,
      retrySelectedRound,
      selectRound,
      sendMessage,
      sendStatus,
      sessionModel,
      sessions,
      setSessionModel,
      stopSession,
      subscribeSession,
      switchPairedDesktop,
      transcript.rounds,
      transcript.roundsComplete,
      transcript.selectedRoundId,
      transcriptView.error,
      transcriptView.items,
      transcriptView.phase,
      transcriptView.roundId,
      transcriptView.truncated,
      unsubscribeSession,
      clientRef,
    ]
  );

  return (
    <MobileRemoteContext.Provider value={value}>
      {children}
    </MobileRemoteContext.Provider>
  );
}

MobileRemoteProviders.displayName = "MobileRemoteProviders";
