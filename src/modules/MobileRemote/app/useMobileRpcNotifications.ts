import { type Dispatch, type SetStateAction, useCallback } from "react";

import type { MobileConnectionState } from "../connection/types";
import type { PermissionBusEnvelope } from "../lib/interactionQueue";
import type { TranscriptSnapshotEnvelope } from "../lib/transcriptLoadState";
import type { MobileConnectionRefs } from "./useMobileConnectionRefs";
import type { useMobilePermissions } from "./useMobilePermissions";
import {
  terminalSignalFromBusEvent,
  type useMobileSend,
} from "./useMobileSend";
import type { useMobileSessionList } from "./useMobileSessionList";
import type { useMobileTranscript } from "./useMobileTranscript";

type TranscriptApi = ReturnType<typeof useMobileTranscript>;
type SendApi = ReturnType<typeof useMobileSend>;

interface UseMobileRpcNotificationsParams {
  refs: Pick<MobileConnectionRefs, "clientRef" | "activeSessionRef">;
  setConnection: Dispatch<SetStateAction<MobileConnectionState>>;
  requestSessionList: ReturnType<
    typeof useMobileSessionList
  >["requestSessionList"];
  receivePermissionEvent: ReturnType<
    typeof useMobilePermissions
  >["receivePermissionEvent"];
  receiveTerminal: SendApi["receiveTerminal"];
  receiveSendStatus: SendApi["receiveSendStatus"];
  receiveSnapshot: TranscriptApi["receiveSnapshot"];
  refreshSubscribedSession: TranscriptApi["refreshSubscribedSession"];
}

/** Routes desktop-originated RPC notifications to their owning hook. */
export function useMobileRpcNotifications({
  refs,
  setConnection,
  requestSessionList,
  receivePermissionEvent,
  receiveTerminal,
  receiveSendStatus,
  receiveSnapshot,
  refreshSubscribedSession,
}: UseMobileRpcNotificationsParams) {
  const { clientRef, activeSessionRef } = refs;
  const handleRpcNotification = useCallback(
    (method: string, params: Record<string, unknown> | undefined) => {
      if (method === "relay/presence") {
        setConnection((prev) => ({
          ...prev,
          presence: params?.online === true ? "online" : "offline",
        }));
        return;
      }
      if (method === "orgii/event") {
        const envelope = params?.envelope as PermissionBusEnvelope | undefined;
        if (envelope) {
          receivePermissionEvent(envelope);
        }
        const terminal = terminalSignalFromBusEvent(params);
        if (terminal) {
          if (terminal.sessionId === activeSessionRef.current) {
            refreshSubscribedSession(terminal.sessionId);
          }
          receiveTerminal(terminal);
        }
        return;
      }
      if (method === "orgii/snapshot") {
        receiveSnapshot(params as TranscriptSnapshotEnvelope);
        return;
      }
      if (method === "session/send_status") {
        const sessionId = receiveSendStatus(params);
        if (sessionId) refreshSubscribedSession(sessionId);
        return;
      }
      if (method === "session/list_changed") {
        const client = clientRef.current;
        if (client) {
          // Keep the previous successful list visible during invalidation.
          // A failed refresh is retried by the next change/reconnect/manual
          // refresh; the generation guard prevents an older reply winning.
          void requestSessionList(client).catch(() => undefined);
        }
      }
    },
    [
      requestSessionList,
      receivePermissionEvent,
      receiveTerminal,
      receiveSendStatus,
      receiveSnapshot,
      refreshSubscribedSession,
      activeSessionRef,
      clientRef,
      setConnection,
    ]
  );

  return handleRpcNotification;
}
