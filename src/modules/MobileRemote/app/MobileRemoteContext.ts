import { createContext, useContext } from "react";

import type { PermissionSheetRequest } from "@src/components/PermissionPrompt";

import type { MobileRpcClient } from "../connection/mobileRpcClient";
import type {
  MobileConnectionConfig,
  MobileConnectionState,
  MobileModelOption,
  MobilePairedDesktopSummary,
  MobileSendAttachment,
  MobileSessionModelState,
  MobileSessionRow,
} from "../connection/types";
import type {
  TranscriptLoadPhase,
  TranscriptRoundSummary,
} from "../lib/transcriptLoadState";
import type { TranscriptItem } from "../lib/transcriptReducer";
import type { MobileSendStatus } from "./useMobileSend";

export interface MobileRemoteContextValue {
  connection: MobileConnectionState;
  sessions: MobileSessionRow[];
  transcriptItems: TranscriptItem[];
  transcriptPhase: TranscriptLoadPhase;
  transcriptError?: string;
  transcriptTruncated: boolean;
  transcriptRounds: TranscriptRoundSummary[];
  transcriptRoundsComplete: boolean;
  /** Null means follow the latest round as the index grows. */
  selectedRoundId: string | null;
  activeRoundId: string | null;
  sendStatus: MobileSendStatus | null;
  activePermission: PermissionSheetRequest | null;
  permissionQueueDepth: number;
  /** True while an answer is on the wire; the sheet must stay disabled. */
  permissionSubmitting: boolean;
  rpc: MobileRpcClient | null;
  connectionConfig: MobileConnectionConfig | null;
  pairedDesktops: MobilePairedDesktopSummary[];
  connectLive: (config: MobileConnectionConfig) => Promise<void>;
  switchPairedDesktop: (desktopId: string) => Promise<void>;
  enterDemoMode: () => void;
  disconnect: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  loadMoreSessions: () => Promise<void>;
  sessionsHasMore: boolean;
  subscribeSession: (sessionId: string) => Promise<void>;
  unsubscribeSession: () => Promise<void>;
  selectRound: (roundId: string | null) => void;
  retrySelectedRound: () => void;
  sendMessage: (
    sessionId: string,
    content: string,
    attachments?: MobileSendAttachment[]
  ) => Promise<void>;
  openSessionFileInDesktop: (
    sessionId: string,
    roundId: string,
    eventId: string,
    targetIndex: number
  ) => Promise<void>;
  respondPermission: (
    response: "allow" | "deny" | "always_allow"
  ) => Promise<void>;
  dismissPermissionHead: () => void;
  stopSession: (sessionId: string) => Promise<void>;
  sessionModel: MobileSessionModelState;
  refreshSessionModel: (sessionId: string) => Promise<void>;
  setSessionModel: (
    sessionId: string,
    option: MobileModelOption
  ) => Promise<void>;
}

export const MobileRemoteContext =
  createContext<MobileRemoteContextValue | null>(null);

export function useMobileRemote(): MobileRemoteContextValue {
  const value = useContext(MobileRemoteContext);
  if (!value) {
    throw new Error(
      "useMobileRemote must be used within MobileRemoteProviders"
    );
  }
  return value;
}
