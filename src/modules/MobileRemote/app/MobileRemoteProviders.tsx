import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { PermissionSheetRequest } from "@src/components/PermissionPrompt";

import { MobileAuthContext } from "../auth/MobileAuthContext";
import { MobileComposerDraftContext } from "../components/composer/MobileComposerDraftContext";
import {
  createMobileComposerDraftStore,
  mobileComposerDesktopScope,
} from "../components/composer/mobileComposerDraftStore";
import {
  desktopIdentityName,
  pairedDesktopId,
  withInitializedDesktop,
} from "../connection/mobileDesktopIdentity";
import {
  type MobileRpcClient,
  createMobileRpcClient,
  toMobileRpcError,
} from "../connection/mobileRpcClient";
import { createRemoteReconnectController } from "../connection/remoteReconnectController";
import { resolveMobileDeviceLabel } from "../connection/resolveMobileDeviceLabel";
import { isPendingPermissions } from "../connection/sessionDiscoveryContract";
import { MobileConnectionAuthorizationError } from "../connection/types";
import type {
  InitializeResult,
  MobileConnectionConfig,
  MobileConnectionState,
  MobileModelOption,
  MobilePairedDesktopSummary,
  MobileSendAttachment,
  MobileSessionModelState,
  MobileSessionRow,
} from "../connection/types";
import {
  DEMO_DESKTOP_NAME,
  DEMO_PERMISSION_REQUEST,
  DEMO_SESSIONS,
} from "../demo/demoFixtures";
import type { PermissionBusEnvelope } from "../lib/interactionQueue";
import type {
  TranscriptLoadPhase,
  TranscriptRoundSummary,
  TranscriptSnapshotEnvelope,
} from "../lib/transcriptLoadState";
import type { TranscriptItem } from "../lib/transcriptReducer";
import { useMobileRemotePlatform } from "../platform";
import type { MobileRemoteRuntimePort } from "../platform/types";
import type { MobileReadStateSync } from "./mobileReadStateSync";
import {
  type MobilePendingInbox,
  useMobilePendingInbox,
} from "./useMobilePendingInbox";
import { useMobilePermissions } from "./useMobilePermissions";
import { useMobileReadStateSync } from "./useMobileReadStateSync";
import {
  type MobileSendStatus,
  terminalSignalFromBusEvent,
  useMobileSend,
} from "./useMobileSend";
import { useMobileSessionList } from "./useMobileSessionList";
import { useMobileSessionModel } from "./useMobileSessionModel";
import { useMobileTranscript } from "./useMobileTranscript";

export type { MobileSendStatus } from "./useMobileSend";

const CONNECT_TIMEOUT_MS = 15_000;
const PAIRING_TIMEOUT_MS = 130_000;

class SupersededConnectionError extends Error {
  constructor() {
    super("Connection was superseded");
  }
}

export interface MobileRemoteContextValue {
  readStateSync: MobileReadStateSync;
  pendingInbox: MobilePendingInbox;
  focusPermission: (requestId: string) => void;
  bootstrapPending: boolean;
  connection: MobileConnectionState;
  sessions: MobileSessionRow[];
  transcriptItems: TranscriptItem[];
  transcriptPhase: TranscriptLoadPhase;
  transcriptSessionId: string | null;
  openingReady: boolean;
  openedSession: {
    requested: string;
    sessionId: string;
    managed: boolean;
  } | null;
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
  /** Failure belongs to the currently presented permission request only. */
  permissionFailed: boolean;
  rpc: MobileRpcClient | null;
  connectionConfig: MobileConnectionConfig | null;
  pairedDesktops: MobilePairedDesktopSummary[];
  connectLive: (config: MobileConnectionConfig) => Promise<void>;
  retryConnection: () => Promise<boolean>;
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
  loadSessionModels: (sessionId: string) => Promise<void>;
  setSessionModel: (
    sessionId: string,
    option: MobileModelOption
  ) => Promise<void>;
}

const MobileRemoteContext = createContext<MobileRemoteContextValue | null>(
  null
);

function waitForSocketOpen(
  socket: WebSocket,
  runtime: Pick<MobileRemoteRuntimePort, "setTimeout" | "clearTimeout">
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      runtime.clearTimeout(timeoutId);
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
    };
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("WebSocket connection failed"));
    };
    const onClose = () => {
      cleanup();
      reject(new Error("WebSocket closed before connecting"));
    };
    const timeoutId = runtime.setTimeout(() => {
      cleanup();
      reject(new Error("WebSocket connection timed out"));
    }, CONNECT_TIMEOUT_MS);
    socket.addEventListener("open", onOpen, { once: true });
    socket.addEventListener("error", onError, { once: true });
    socket.addEventListener("close", onClose, { once: true });
  });
}

function waitForPairingApproval(
  socket: WebSocket,
  client: MobileRpcClient,
  runtime: Pick<MobileRemoteRuntimePort, "setTimeout" | "clearTimeout">
): Promise<void> {
  return new Promise((resolve, reject) => {
    let unsubscribe: () => void = () => undefined;
    const cleanup = () => {
      runtime.clearTimeout(timeoutId);
      unsubscribe();
      socket.removeEventListener("close", onClose);
    };
    const onClose = () => {
      cleanup();
      reject(new Error("Connection closed before pairing was approved"));
    };
    const timeoutId = runtime.setTimeout(() => {
      cleanup();
      reject(new Error("Pairing confirmation expired"));
    }, PAIRING_TIMEOUT_MS);
    unsubscribe = client.onNotification((method) => {
      if (method === "pairing/approved") {
        cleanup();
        resolve();
      }
    });
    socket.addEventListener("close", onClose, { once: true });
  });
}

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
  const draftStore = useMemo(createMobileComposerDraftStore, [
    authUserId,
    auth?.session.supabaseUrl,
    relayUrl,
  ]);
  useEffect(() => () => draftStore.clear(), [draftStore]);
  const authRef = useRef(auth);
  authRef.current = auth;
  const preparationRef = useRef<AbortController | null>(null);
  const clientRef = useRef<MobileRpcClient | null>(null);
  const permissionRevisionRef = useRef(0);
  const socketRef = useRef<WebSocket | null>(null);
  const activeSessionRef = useRef<string | null>(null);
  const unsubscribeRpcRef = useRef<(() => void) | null>(null);
  const activeConfigRef = useRef<MobileConnectionConfig | null>(null);
  const generationRef = useRef(0);
  const selectionIntentRef = useRef(0);
  const retryFlightRef = useRef<Promise<boolean> | null>(null);
  const recoverRef = useRef<
    (config: MobileConnectionConfig, generation: number) => Promise<void>
  >(async () => undefined);
  const reconnect = useMemo(
    () =>
      createRemoteReconnectController(
        platform.runtime,
        (generation) => generation === generationRef.current,
        (config, generation) => recoverRef.current(config, generation)
      ),
    [platform.runtime]
  );
  const connectionWriteChainRef = useRef<Promise<void>>(Promise.resolve());
  const inventoryRevisionRef = useRef(0);
  const scheduleReconnectRef = useRef<
    (config: MobileConnectionConfig, generation: number) => void
  >(() => undefined);

  const [connection, setConnection] = useState<MobileConnectionState>({
    status: "disconnected",
    presence: "unknown",
    demoMode: demoByDefault && !suppressInitialBootstrap,
  });
  const [connectionConfig, setConnectionConfig] =
    useState<MobileConnectionConfig | null>(null);
  const [bootstrapPending, setBootstrapPending] = useState(
    !suppressInitialBootstrap
  );
  const [pairedDesktops, setPairedDesktops] = useState<
    MobilePairedDesktopSummary[]
  >([]);
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const readStateSync = useMobileReadStateSync(
    connection.status === "connected" &&
      connection.presence === "online" &&
      connection.capabilities?.sessionReadState === true
      ? clientRef.current
      : null,
    JSON.stringify([
      authUserId,
      auth?.session.supabaseUrl,
      mobileComposerDesktopScope(connectionConfig, connection),
    ])
  );
  const { sessions, sessionsHasMore, requestSessionList, resetSessions } =
    useMobileSessionList(clientRef);
  const {
    openingClient,
    openedSession,
    releaseOpening,
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
  }, [connection.presence, connection.status, connection.tier]);

  const {
    activePermission,
    focusPermission,
    permissionQueueDepth,
    permissionSubmitting,
    permissionFailed,
    respondPermission,
    dismissPermissionHead,
    resetPermissions,
    receivePermissionEvent,
    reconcilePermissions,
    reconcileSessionPermissions,
  } = useMobilePermissions({
    sessionId: transcript.sessionId,
    demoMode: connection.demoMode,
    requireWritableClient,
  });

  const pendingInbox = useMobilePendingInbox({
    client: clientRef.current,
    scope: JSON.stringify([
      authUserId,
      relayUrl,
      connectionConfig?.desktopId ?? connection.desktopId,
      connectionConfig?.host,
      connectionConfig?.port,
    ]),
    online:
      connection.status === "connected" && connection.presence === "online",
    supported: connection.capabilities?.pendingInteractions === true,
    runtime: platform.runtime,
    onSnapshot: reconcilePermissions,
  });

  const {
    sessionModel,
    refreshSessionModel,
    loadSessionModels,
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

  const persistConnection = useCallback(
    (config: MobileConnectionConfig | null) => {
      const generation = generationRef.current;
      const inventoryRevision = ++inventoryRevisionRef.current;
      const operation = connectionWriteChainRef.current.then(async () => {
        if (generation !== generationRef.current) return;
        await platform.connection.save(authUserId, config);
        void platform.connection
          .listPairedDesktops(authUserId)
          .then((inventory) => {
            if (
              generation === generationRef.current &&
              inventoryRevision === inventoryRevisionRef.current
            )
              setPairedDesktops(inventory);
          })
          .catch(() => undefined);
      });
      connectionWriteChainRef.current = operation.catch(() => undefined);
      return operation;
    },
    [authUserId, platform.connection]
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
    [reconnect, invalidateTranscriptRequests]
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
  ]);

  const handleRpcNotification = useCallback(
    (method: string, params: Record<string, unknown> | undefined) => {
      if (method === "interaction/pending_changed") {
        permissionRevisionRef.current++;
        return;
      }
      if (method === "relay/presence") {
        const previous = connectionRef.current;
        const next: MobileConnectionState = {
          ...previous,
          presence: params?.online === true ? "online" : "offline",
        };
        // Relay can retain the phone socket while replacing the Desktop actor.
        // Presence is an invalidation edge, not just a status-dot update. Write
        // the edge synchronously so duplicate notifications cannot refresh twice.
        connectionRef.current = next;
        setConnection(next);
        const client = clientRef.current;
        if (
          client &&
          previous.status === "connected" &&
          previous.presence !== "online" &&
          next.presence === "online"
        ) {
          const generation = generationRef.current;
          void requestSessionList(client).catch(() => {
            if (
              clientRef.current !== client ||
              generationRef.current !== generation ||
              connectionRef.current.presence !== "online"
            )
              return;
            const config = activeConfigRef.current;
            if (!config || config.pairingCode) return;
            // A failed recovery must not leave an empty, apparently online UI.
            // Reuse the bounded, visibility-aware reconnect owner.
            releaseTransport(true);
            setConnection((prev) => ({
              ...prev,
              status: "connecting",
              presence: "offline",
            }));
            scheduleReconnectRef.current(config, generation);
          });
          // Desktop's recreated actor also lost its active transcript subscription.
          if (activeSessionRef.current)
            refreshSubscribedSession(activeSessionRef.current);
        }
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
      releaseTransport,
      receivePermissionEvent,
      receiveTerminal,
      receiveSendStatus,
      receiveSnapshot,
      refreshSubscribedSession,
    ]
  );

  const establishConnection = useCallback(
    async (config: MobileConnectionConfig, generation: number) => {
      const deviceLabel =
        config.deviceLabel?.trim() ||
        platform.clientInfo.defaultDeviceLabel ||
        resolveMobileDeviceLabel();
      const transportConfig = { ...config, deviceLabel };
      preparationRef.current?.abort();
      const preparation = new AbortController();
      preparationRef.current = preparation;
      let preparedUrl: string;
      try {
        preparedUrl = await platform.connection.prepareSocketUrl(
          transportConfig,
          {
            authUserId,
            signal: preparation.signal,
            getSession: async () => {
              const getSession = authRef.current?.getConnectionSession;
              if (!getSession) throw new Error("Sign in to connect to Relay");
              return getSession();
            },
          }
        );
        preparation.signal.throwIfAborted();
        if (generation !== generationRef.current || platform.runtime.isHidden())
          throw new SupersededConnectionError();
      } catch (error) {
        if (preparation.signal.aborted) throw new SupersededConnectionError();
        if (error instanceof MobileConnectionAuthorizationError) {
          draftStore.clearDesktop(mobileComposerDesktopScope(config, {}));
        }
        throw error;
      } finally {
        if (preparationRef.current === preparation)
          preparationRef.current = null;
      }
      const socket = platform.connection.createSocket(preparedUrl);
      let authenticated = false;
      let intentionalClose = false;
      let authorizationDenied = false;
      let pairedConfig = config;
      // Policy closes during initialize are just as terminal as post-handshake
      // revocation. The RPC client's generic close error must not trigger retries.
      socket.addEventListener(
        "close",
        (event) => {
          authorizationDenied = event.code === 1008;
        },
        { once: true }
      );
      socketRef.current = socket;

      try {
        await waitForSocketOpen(socket, platform.runtime);
        if (generation !== generationRef.current) {
          intentionalClose = true;
          socket.close();
          throw new SupersededConnectionError();
        }

        const client = createMobileRpcClient(socket, platform.runtime);
        clientRef.current = client;
        unsubscribeRpcRef.current = client.onNotification(
          handleRpcNotification
        );
        if (config.pairingCode) {
          await waitForPairingApproval(socket, client, platform.runtime);
          if (
            generation !== generationRef.current ||
            socketRef.current !== socket
          )
            throw new SupersededConnectionError();
          // Relay approval, not Desktop availability, finalizes pairing. Keep
          // the durable device credential, but never replay the one-time code.
          const { pairingCode: _approvedCode, ...confirmed } = config;
          pairedConfig = confirmed;
          activeConfigRef.current = confirmed;
          setConnectionConfig(confirmed);
          void persistConnection(confirmed).catch(() => undefined);
        }

        const init = await client.call<InitializeResult>("initialize", {
          protocolVersion: 1,
          clientInfo: {
            name: platform.clientInfo.name,
            version: platform.clientInfo.version,
          },
          capabilities: { interactions: ["permission"], streaming: true },
          deviceLabel,
        });
        if (
          generation !== generationRef.current ||
          socketRef.current !== socket
        ) {
          intentionalClose = true;
          client.close();
          throw new SupersededConnectionError();
        }

        authenticated = true;
        reconnect.reset();
        const identifiedConfig = withInitializedDesktop(pairedConfig, init);
        const desktopName = desktopIdentityName(
          identifiedConfig.desktopIdentity
        );
        if (identifiedConfig !== config) {
          activeConfigRef.current = identifiedConfig;
          setConnectionConfig(identifiedConfig);
          // Publish verified metadata immediately; secure-storage latency must not
          // delay sessions or display an opaque ID after initialize succeeds.
          setPairedDesktops((desktops) => {
            const id = pairedDesktopId(config);
            const existing = desktops.find((desktop) => desktop.id === id);
            return [
              {
                id,
                name: desktopName ?? existing?.name ?? id,
                active: true,
                updatedAtMs: existing?.updatedAtMs ?? platform.runtime.now(),
                desktopIdentity: identifiedConfig.desktopIdentity,
              },
              ...desktops
                .filter((desktop) => desktop.id !== id)
                .map((desktop) => ({ ...desktop, active: false })),
            ].slice(0, 20);
          });
        }
        // Retry the confirmed credential write even without desktop metadata:
        // an earlier approval save may have failed before Desktop came online.
        void persistConnection(identifiedConfig).catch(() => undefined);
        const connected: MobileConnectionState = {
          status: "connected",
          presence: "online",
          desktopId: init.desktopId ?? config.desktopId,
          desktopName: desktopName ?? config.desktopId ?? config.host,
          // Authorization is server-owned. An older/incomplete initialize
          // response must never silently upgrade the phone to write access.
          tier: init.tier ?? "read_only",
          capabilities: init.capabilities,
          demoMode: false,
        };
        // Restoration runs before React commits; use this handshake's capabilities.
        connectionRef.current = connected;
        setConnection(connected);
        socket.addEventListener(
          "close",
          (event) => {
            if (
              intentionalClose ||
              !authenticated ||
              generation !== generationRef.current ||
              socketRef.current !== socket
            ) {
              return;
            }
            releaseTransport(false);
            if (event.code === 1008) {
              draftStore.clearDesktop(
                mobileComposerDesktopScope(identifiedConfig, {
                  desktopId: identifiedConfig.desktopId,
                })
              );
              activeConfigRef.current = null;
              setConnection((prev) => ({
                ...prev,
                status: "error",
                presence: "offline",
                error: toMobileRpcError(
                  new MobileConnectionAuthorizationError(
                    "Device access was revoked or pairing expired"
                  )
                ),
              }));
              return;
            }
            setConnection((prev) => ({
              ...prev,
              status: "connecting",
              presence: "offline",
              error: undefined,
            }));
            scheduleReconnectRef.current(identifiedConfig, generation);
          },
          { once: true }
        );
        // The roster is independent of the selected conversation. A slow list
        // must not serialize reconnect → latest body behind unrelated sessions.
        const restoreActiveSession = async () => {
          if (
            socketRef.current !== socket ||
            generation !== generationRef.current
          )
            return;
          const sessionId = activeSessionRef.current;
          if (!sessionId) return;
          const subscriptionGeneration = beginLoad(sessionId);
          await requestSessionSnapshot(
            client,
            sessionId,
            subscriptionGeneration
          ).catch(() => undefined);
        };
        await Promise.all([restoreActiveSession(), requestSessionList(client)]);
      } catch (error) {
        intentionalClose = true;
        if (socketRef.current !== socket) throw new SupersededConnectionError();
        releaseTransport(true);
        if (
          authorizationDenied ||
          error instanceof MobileConnectionAuthorizationError
        ) {
          draftStore.clearDesktop(mobileComposerDesktopScope(config, {}));
        }
        if (authorizationDenied)
          throw new MobileConnectionAuthorizationError(
            "Device access was revoked or pairing expired"
          );
        throw error;
      }
    },
    [
      authUserId,
      draftStore,
      reconnect,
      handleRpcNotification,
      platform.clientInfo,
      platform.connection,
      platform.runtime,
      persistConnection,
      releaseTransport,
      requestSessionList,
      requestSessionSnapshot,
      beginLoad,
    ]
  );

  const runReconnect = useCallback(
    async (config: MobileConnectionConfig, generation: number) => {
      if (generation !== generationRef.current || platform.runtime.isHidden()) {
        return;
      }
      setConnection((prev) => ({
        ...prev,
        status: "connecting",
        presence: "offline",
        error: undefined,
      }));
      try {
        await establishConnection(config, generation);
      } catch (error) {
        if (
          generation !== generationRef.current ||
          error instanceof SupersededConnectionError
        )
          return;
        const retryConfig = activeConfigRef.current;
        const denied = error instanceof MobileConnectionAuthorizationError;
        const retryable = !denied && retryConfig && !retryConfig.pairingCode;
        if (!retryable) activeConfigRef.current = null;
        setConnection((prev) => ({
          ...prev,
          status: retryable ? "connecting" : "error",
          presence: "offline",
          error: toMobileRpcError(error),
        }));
        if (retryable) scheduleReconnectRef.current(retryConfig, generation);
      }
    },
    [establishConnection, platform.runtime]
  );

  recoverRef.current = runReconnect;
  scheduleReconnectRef.current = reconnect.schedule;

  const connectLive = useCallback(
    async (config: MobileConnectionConfig) => {
      setBootstrapPending(false);
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
      setConnection((prev) => ({
        ...prev,
        status: "connecting",
        presence: "unknown",
        demoMode: false,
        error: undefined,
      }));
      let configurationSaved = false;
      try {
        await persistConnection(config);
        configurationSaved = true;
        if (generation !== generationRef.current) {
          throw new Error("Connection was superseded");
        }
        await establishConnection(config, generation);
      } catch (error) {
        if (
          generation === generationRef.current &&
          !(error instanceof SupersededConnectionError)
        ) {
          const retryConfig = activeConfigRef.current;
          const retryable =
            configurationSaved &&
            !(error instanceof MobileConnectionAuthorizationError) &&
            retryConfig &&
            !retryConfig.pairingCode;
          if (!retryable) activeConfigRef.current = null;
          setConnection({
            status: retryable ? "connecting" : "error",
            presence: "offline",
            demoMode: false,
            error: toMobileRpcError(error),
          });
          if (retryable) scheduleReconnectRef.current(retryConfig, generation);
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
    ]
  );

  // User-directed recovery preserves the selected pairing. It deliberately uses
  // the same authenticated handshake as first connect; policy errors never loop.
  const retryConnection = useCallback((): Promise<boolean> => {
    if (retryFlightRef.current) return retryFlightRef.current;
    const intent = ++selectionIntentRef.current;
    const operation = Promise.resolve().then(async () => {
      if (intent !== selectionIntentRef.current) return false;
      let config = connectionConfig;
      if (!config) {
        setBootstrapPending(true);
        try {
          config = relayUrl?.trim()
            ? { wsUrl: relayUrl.trim() }
            : await platform.connection.load(authUserId);
        } catch (error) {
          if (intent === selectionIntentRef.current) {
            setBootstrapPending(false);
            setConnection({
              status: "error",
              presence: "offline",
              demoMode: false,
              error: toMobileRpcError(error),
            });
          }
          throw error;
        }
        if (intent !== selectionIntentRef.current) return false;
        setBootstrapPending(false);
      }
      if (!config) {
        setConnection({
          status: "disconnected",
          presence: "unknown",
          demoMode: false,
        });
        return false;
      }
      await connectLive(config);
      return true;
    });
    retryFlightRef.current = operation;
    const settled = () => {
      if (retryFlightRef.current === operation) retryFlightRef.current = null;
    };
    void operation.then(settled, settled);
    return operation;
  }, [
    authUserId,
    connectLive,
    connectionConfig,
    platform.connection,
    relayUrl,
  ]);

  const disconnect = useCallback(async () => {
    draftStore.clearDesktop(
      mobileComposerDesktopScope(activeConfigRef.current, connection)
    );
    setBootstrapPending(false);
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
    const generation = generationRef.current;
    try {
      await persistConnection(null);
    } catch (error) {
      if (generation === generationRef.current) {
        setConnection({
          status: "error",
          presence: "offline",
          demoMode: false,
          error: toMobileRpcError(error),
        });
      }
      throw error;
    }
  }, [
    connection,
    draftStore,
    resetTranscript,
    clearReconnectTimer,
    persistConnection,
    releaseTransport,
    resetSessions,
    resetPermissions,
    resetSend,
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
    [authUserId, connectLive, platform.connection]
  );

  const refreshSessions = useCallback(async () => {
    if (connection.demoMode) {
      resetSessions(DEMO_SESSIONS);
      return;
    }
    const client = clientRef.current;
    if (!client || connection.presence !== "online") return;
    readStateSync.refresh();
    await requestSessionList(client);
  }, [
    connection.demoMode,
    connection.presence,
    requestSessionList,
    resetSessions,
    readStateSync,
  ]);

  const loadMoreSessions = useCallback(async () => {
    const client = clientRef.current;
    if (!client || connection.presence !== "online" || !sessionsHasMore) return;
    await requestSessionList(client, true);
  }, [connection.presence, sessionsHasMore, requestSessionList]);

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
      const canonicalId = activeSessionRef.current;
      if (!canonicalId || clientRef.current !== client) return;
      // Model hydration must progress even when permission recovery stalls/fails.
      const modelReady = refreshSessionModel(canonicalId);
      if (currentConnection.capabilities?.pendingInteractions) {
        const revision = permissionRevisionRef.current;
        const pending = await client
          .call<{
            interactions: PermissionSheetRequest[];
            complete: boolean;
          }>("interaction/pending", { sessionId: canonicalId })
          .catch(() => null);
        if (
          clientRef.current === client &&
          activeSessionRef.current === canonicalId &&
          revision === permissionRevisionRef.current &&
          pending?.complete &&
          isPendingPermissions(pending.interactions)
        ) {
          reconcileSessionPermissions(canonicalId, pending.interactions);
        }
      }
      await modelReady;
    },
    [
      reconcileSessionPermissions,
      refreshSessionModel,
      requestSessionSnapshot,
      resetSend,
      beginLoad,
      failLoad,
      showDemoTranscript,
    ]
  );

  const unsubscribeSession = useCallback(async () => {
    const sessionId = activeSessionRef.current;
    const releasedOpening = releaseOpening();
    activeSessionRef.current = null;
    resetTranscript();
    resetSend();
    resetSessionModel();
    const currentConnection = connectionRef.current;
    if (currentConnection.demoMode || !sessionId || releasedOpening) return;
    if (clientRef.current && currentConnection.presence === "online") {
      await clientRef.current.call("session/unsubscribe", { sessionId });
    }
  }, [releaseOpening, resetSessionModel, resetSend, resetTranscript]);

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
        void reconnect.run(config, generationRef.current);
      }
    };
    return platform.runtime.subscribeVisibility(handleVisible);
  }, [clearReconnectTimer, platform.runtime, releaseTransport, reconnect]);

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
      // Inventory is ancillary; it must not delay restoration of the selected device.
      void platform.connection
        .listPairedDesktops(authUserId)
        .then((inventory) => {
          if (!disposed && bootstrapGeneration === generationRef.current)
            setPairedDesktops(inventory);
        })
        .catch(() => undefined);
      const config = relayUrl?.trim()
        ? { wsUrl: relayUrl.trim() }
        : await platform.connection.load(authUserId);
      if (disposed || bootstrapGeneration !== generationRef.current) {
        return;
      }
      setConnectionConfig(config);
      setBootstrapPending(false);
      if (config?.wsUrl || config?.host) {
        await connectLive(config).catch(() => undefined);
      } else if (demoByDefault) {
        enterDemoMode();
      }
    })().catch((error) => {
      if (disposed || bootstrapGeneration !== generationRef.current) return;
      setBootstrapPending(false);
      setConnection({
        status: "error",
        presence: "offline",
        demoMode: false,
        error: toMobileRpcError(error),
      });
    });
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
      pendingInbox,
      focusPermission,
      bootstrapPending,
      connection,
      sessions,
      transcriptItems: transcriptView.items,
      transcriptPhase: transcriptView.phase,
      transcriptSessionId: transcript.sessionId,
      openedSession,
      openingReady:
        openingClient === clientRef.current &&
        (transcript.indexPhase === "ready" ||
          transcript.indexPhase === "empty"),
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
      permissionFailed,
      rpc: clientRef.current,
      readStateSync,
      connectionConfig,
      pairedDesktops,
      connectLive,
      retryConnection,
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
      loadSessionModels,
      setSessionModel,
    }),
    [
      pendingInbox,
      focusPermission,
      bootstrapPending,
      activePermission,
      readStateSync,
      connectLive,
      retryConnection,
      connectionConfig,
      connection,
      dismissPermissionHead,
      disconnect,
      enterDemoMode,
      permissionQueueDepth,
      permissionSubmitting,
      permissionFailed,
      refreshSessionModel,
      loadSessionModels,
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
      openingClient,
      openedSession,
      transcript.indexPhase,
      transcript.rounds,
      transcript.sessionId,
      transcript.roundsComplete,
      transcript.selectedRoundId,
      transcriptView.error,
      transcriptView.items,
      transcriptView.phase,
      transcriptView.roundId,
      transcriptView.truncated,
      unsubscribeSession,
    ]
  );

  return (
    <MobileRemoteContext.Provider value={value}>
      <MobileComposerDraftContext.Provider value={draftStore}>
        {children}
      </MobileComposerDraftContext.Provider>
    </MobileRemoteContext.Provider>
  );
}

export function useMobileRemote(): MobileRemoteContextValue {
  const value = useContext(MobileRemoteContext);
  if (!value) {
    throw new Error(
      "useMobileRemote must be used within MobileRemoteProviders"
    );
  }
  return value;
}

MobileRemoteProviders.displayName = "MobileRemoteProviders";
