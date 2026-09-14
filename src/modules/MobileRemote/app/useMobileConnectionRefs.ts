import { useRef } from "react";

import type { MobileRpcClient } from "../connection/mobileRpcClient";
import type { MobileConnectionConfig } from "../connection/types";

export type MobileConnectionRefs = ReturnType<typeof useMobileConnectionRefs>;

/** Mutable transport identity shared by the provider's connection hooks. */
export function useMobileConnectionRefs() {
  const preparationRef = useRef<AbortController | null>(null);
  const clientRef = useRef<MobileRpcClient | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const activeSessionRef = useRef<string | null>(null);
  const unsubscribeRpcRef = useRef<(() => void) | null>(null);
  const activeConfigRef = useRef<MobileConnectionConfig | null>(null);
  const generationRef = useRef(0);
  const selectionIntentRef = useRef(0);
  const recoverRef = useRef<
    (config: MobileConnectionConfig, generation: number) => Promise<void>
  >(async () => undefined);
  const connectionWriteChainRef = useRef<Promise<void>>(Promise.resolve());
  const scheduleReconnectRef = useRef<
    (config: MobileConnectionConfig, generation: number) => void
  >(() => undefined);

  return {
    preparationRef,
    clientRef,
    socketRef,
    activeSessionRef,
    unsubscribeRpcRef,
    activeConfigRef,
    generationRef,
    selectionIntentRef,
    recoverRef,
    connectionWriteChainRef,
    scheduleReconnectRef,
  };
}
