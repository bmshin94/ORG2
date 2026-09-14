import { type RefObject, useCallback } from "react";

import type { MobileRpcClient } from "../connection/mobileRpcClient";
import type { MobileConnectionState } from "../connection/types";
import { DEMO_SESSIONS } from "../demo/demoFixtures";
import type { MobileConnectionRefs } from "./useMobileConnectionRefs";
import type { useMobileSend } from "./useMobileSend";
import type { useMobileSessionList } from "./useMobileSessionList";
import type { useMobileSessionModel } from "./useMobileSessionModel";
import type { useMobileTranscript } from "./useMobileTranscript";

type TranscriptApi = ReturnType<typeof useMobileTranscript>;
type SessionListApi = ReturnType<typeof useMobileSessionList>;
type SessionModelApi = ReturnType<typeof useMobileSessionModel>;

interface UseMobileSessionActionsParams {
  connection: MobileConnectionState;
  connectionRef: RefObject<MobileConnectionState>;
  refs: Pick<MobileConnectionRefs, "clientRef" | "activeSessionRef">;
  sessionsHasMore: boolean;
  requireWritableClient: () => MobileRpcClient;
  requestSessionList: SessionListApi["requestSessionList"];
  resetSessions: SessionListApi["resetSessions"];
  resetSend: ReturnType<typeof useMobileSend>["resetSend"];
  beginLoad: TranscriptApi["beginLoad"];
  failLoad: TranscriptApi["failLoad"];
  showDemoTranscript: TranscriptApi["showDemoTranscript"];
  requestSessionSnapshot: TranscriptApi["requestSessionSnapshot"];
  resetTranscript: TranscriptApi["resetTranscript"];
  refreshSessionModel: SessionModelApi["refreshSessionModel"];
  resetSessionModel: SessionModelApi["resetSessionModel"];
}

/** Session-scoped RPC actions exposed through the provider context. */
export function useMobileSessionActions({
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
}: UseMobileSessionActionsParams) {
  const { clientRef, activeSessionRef } = refs;

  const refreshSessions = useCallback(async () => {
    if (connection.demoMode) {
      resetSessions(DEMO_SESSIONS);
      return;
    }
    const client = clientRef.current;
    if (!client || connection.presence !== "online") return;
    await requestSessionList(client);
  }, [
    connection.demoMode,
    connection.presence,
    requestSessionList,
    resetSessions,
    clientRef,
  ]);

  const loadMoreSessions = useCallback(async () => {
    const client = clientRef.current;
    if (!client || connection.presence !== "online" || !sessionsHasMore) return;
    await requestSessionList(client, true);
  }, [connection.presence, sessionsHasMore, requestSessionList, clientRef]);

  const subscribeSession = useCallback(
    async (sessionId: string) => {
      activeSessionRef.current = sessionId;
      resetSend();
      const subscriptionGeneration = beginLoad(sessionId);
      const currentConnection = connectionRef.current;
      if (currentConnection.demoMode) {
        showDemoTranscript(sessionId);
        await refreshSessionModel(sessionId);
        return;
      }
      const client = clientRef.current;
      if (!client || currentConnection.presence !== "online") {
        const error = new Error("Desktop is offline");
        failLoad(sessionId, subscriptionGeneration, error.message);
        throw error;
      }
      const applied = await requestSessionSnapshot(
        client,
        sessionId,
        subscriptionGeneration
      );
      if (!applied) return;
      await refreshSessionModel(sessionId);
    },
    [
      refreshSessionModel,
      requestSessionSnapshot,
      resetSend,
      beginLoad,
      failLoad,
      showDemoTranscript,
      activeSessionRef,
      clientRef,
      connectionRef,
    ]
  );

  const unsubscribeSession = useCallback(async () => {
    const sessionId = activeSessionRef.current;
    activeSessionRef.current = null;
    resetTranscript();
    resetSend();
    resetSessionModel();
    const currentConnection = connectionRef.current;
    if (currentConnection.demoMode || !sessionId) return;
    if (clientRef.current && currentConnection.presence === "online") {
      await clientRef.current.call("session/unsubscribe", { sessionId });
    }
  }, [
    resetSessionModel,
    resetSend,
    resetTranscript,
    activeSessionRef,
    clientRef,
    connectionRef,
  ]);

  const openSessionFileInDesktop = useCallback(
    async (
      sessionId: string,
      roundId: string,
      eventId: string,
      targetIndex: number
    ) => {
      if (!sessionId || !roundId || !eventId) return;
      if (connection.demoMode) {
        throw new Error("Desktop file navigation is unavailable in demo mode");
      }
      await requireWritableClient().call("session/open_file", {
        sessionId,
        roundId,
        eventId,
        targetIndex,
      });
    },
    [connection.demoMode, requireWritableClient]
  );

  const stopSession = useCallback(
    async (sessionId: string) => {
      if (connection.demoMode) return;
      await requireWritableClient().call("session/cancel", { sessionId });
    },
    [connection.demoMode, requireWritableClient]
  );

  return {
    refreshSessions,
    loadMoreSessions,
    subscribeSession,
    unsubscribeSession,
    openSessionFileInDesktop,
    stopSession,
  };
}
