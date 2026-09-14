import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
} from "react";

import type { MobileAuthContextValue } from "../auth/MobileAuthContext";
import {
  createMobileRpcClient,
  toMobileRpcError,
} from "../connection/mobileRpcClient";
import { resolveMobileDeviceLabel } from "../connection/resolveMobileDeviceLabel";
import { MobileConnectionAuthorizationError } from "../connection/types";
import type {
  InitializeResult,
  MobileConnectionConfig,
  MobileConnectionState,
} from "../connection/types";
import { DEMO_DESKTOP_NAME } from "../demo/demoFixtures";
import type { MobileRemotePlatform } from "../platform/types";
import {
  waitForPairingApproval,
  waitForSocketOpen,
} from "./mobileSocketHandshake";
import type { MobileConnectionRefs } from "./useMobileConnectionRefs";
import type {
  RemoteReconnectController,
  useMobileConnectionTransport,
} from "./useMobileConnectionTransport";
import type { useMobileRpcNotifications } from "./useMobileRpcNotifications";
import type { useMobileSessionList } from "./useMobileSessionList";
import type { useMobileTranscript } from "./useMobileTranscript";

type TranscriptApi = ReturnType<typeof useMobileTranscript>;

interface UseMobileConnectionEstablishParams {
  platform: MobileRemotePlatform;
  authUserId: string;
  authRef: RefObject<MobileAuthContextValue | null>;
  refs: MobileConnectionRefs;
  reconnect: RemoteReconnectController;
  setConnection: Dispatch<SetStateAction<MobileConnectionState>>;
  releaseTransport: ReturnType<
    typeof useMobileConnectionTransport
  >["releaseTransport"];
  handleRpcNotification: ReturnType<typeof useMobileRpcNotifications>;
  requestSessionList: ReturnType<
    typeof useMobileSessionList
  >["requestSessionList"];
  requestSessionSnapshot: TranscriptApi["requestSessionSnapshot"];
  beginLoad: TranscriptApi["beginLoad"];
}

/** Opens, authenticates, and re-opens the desktop socket for one generation. */
export function useMobileConnectionEstablish({
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
}: UseMobileConnectionEstablishParams) {
  const {
    preparationRef,
    clientRef,
    socketRef,
    activeSessionRef,
    unsubscribeRpcRef,
    activeConfigRef,
    generationRef,
    scheduleReconnectRef,
  } = refs;

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
          throw new Error("Connection was superseded");
      } finally {
        if (preparationRef.current === preparation)
          preparationRef.current = null;
      }
      const socket = platform.connection.createSocket(preparedUrl);
      let authenticated = false;
      let intentionalClose = false;
      socketRef.current = socket;

      try {
        await waitForSocketOpen(socket, platform.runtime);
        if (generation !== generationRef.current) {
          intentionalClose = true;
          socket.close();
          throw new Error("Connection was superseded");
        }

        const client = createMobileRpcClient(socket, platform.runtime);
        clientRef.current = client;
        unsubscribeRpcRef.current = client.onNotification(
          handleRpcNotification
        );
        if (config.pairingCode) {
          await waitForPairingApproval(socket, client, platform.runtime);
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
        if (generation !== generationRef.current) {
          intentionalClose = true;
          client.close();
          throw new Error("Connection was superseded");
        }

        authenticated = true;
        reconnect.reset();
        setConnection({
          status: "connected",
          presence: "online",
          desktopId: init.desktopId ?? config.desktopId,
          desktopName: init.desktopName ?? DEMO_DESKTOP_NAME,
          // Authorization is server-owned. An older/incomplete initialize
          // response must never silently upgrade the phone to write access.
          tier: init.tier ?? "read_only",
          capabilities: init.capabilities,
          demoMode: false,
        });
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
            scheduleReconnectRef.current(config, generation);
          },
          { once: true }
        );
        await requestSessionList(client);
        if (
          socketRef.current !== socket ||
          generation !== generationRef.current
        )
          return;
        if (activeSessionRef.current) {
          const sessionId = activeSessionRef.current;
          const subscriptionGeneration = beginLoad(sessionId);
          await requestSessionSnapshot(
            client,
            sessionId,
            subscriptionGeneration
          ).catch(() => undefined);
        }
      } catch (error) {
        intentionalClose = true;
        if (socketRef.current === socket) releaseTransport(true);
        throw error;
      }
    },
    [
      authUserId,
      reconnect,
      handleRpcNotification,
      platform.clientInfo,
      platform.connection,
      platform.runtime,
      releaseTransport,
      requestSessionList,
      requestSessionSnapshot,
      beginLoad,
      activeConfigRef,
      activeSessionRef,
      authRef,
      clientRef,
      generationRef,
      preparationRef,
      scheduleReconnectRef,
      setConnection,
      socketRef,
      unsubscribeRpcRef,
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
        if (generation !== generationRef.current) return;
        const denied = error instanceof MobileConnectionAuthorizationError;
        if (denied) activeConfigRef.current = null;
        setConnection((prev) => ({
          ...prev,
          status: denied ? "error" : "connecting",
          presence: "offline",
          error: toMobileRpcError(error),
        }));
        if (!denied) scheduleReconnectRef.current(config, generation);
      }
    },
    [
      establishConnection,
      platform.runtime,
      activeConfigRef,
      generationRef,
      scheduleReconnectRef,
      setConnection,
    ]
  );

  return { establishConnection, runReconnect };
}
