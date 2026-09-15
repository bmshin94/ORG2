import { useCallback, useEffect, useMemo, useState } from "react";

import type { MobileRpcClient } from "../connection/mobileRpcClient";
import {
  MobileSessionIdentityInvalidated,
  cachedMobileSessionIdentity,
  invalidateMobileSessionIdentities,
  resolveMobileSessionIdentity,
} from "../connection/mobileSessionIdentityCache";

type Resolution = {
  client: MobileRpcClient;
  requested: string;
  sessionId?: string;
  managed?: boolean;
  error?: string;
};

/** Resolve before mounting chat so config, send, stop and subscription share an owner. */
export function useMobileSessionIdentity(
  client: MobileRpcClient | null,
  requested: string,
  supported: boolean,
  online: boolean
) {
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [previousOnline, setPreviousOnline] = useState(online);
  const [attempt, setAttempt] = useState(0);
  // A relay can restore Desktop on the same phone socket. An error belongs
  // to the old presence interval, not the recovered actor. Adjust it before
  // committing children; keep successful history readable while offline.
  if (previousOnline !== online) {
    setPreviousOnline(online);
    if (online || resolution?.error) setResolution(null);
  }
  const retry = useCallback(() => {
    setResolution(null);
    setAttempt((value) => value + 1);
  }, []);
  const cached =
    client && online
      ? cachedMobileSessionIdentity(client, requested)
      : undefined;
  const cachedResolution = useMemo(
    () => (cached && client ? { client, requested, ...cached } : null),
    [cached, client, requested]
  );
  // Retain a cache hit in this mounted view as well, so taking the connection
  // offline does not erase already displayed read-only content.
  if (cachedResolution && resolution !== cachedResolution) {
    setResolution(cachedResolution);
  }
  const current: Resolution | null =
    resolution?.client === client &&
    (resolution?.requested === requested || resolution?.sessionId === requested)
      ? resolution
      : cachedResolution;
  useEffect(() => {
    if (client && !online) invalidateMobileSessionIdentities(client);
    if (!supported || !online || !client || current) return;
    let active = true;
    void resolveMobileSessionIdentity(client, requested)
      .then((result) => {
        if (active) {
          setResolution({
            client,
            requested,
            sessionId: result.sessionId,
            managed: result.managed,
          });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          if (error instanceof MobileSessionIdentityInvalidated) {
            setAttempt((value) => value + 1);
            return;
          }
          setResolution({
            client,
            requested,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      active = false;
    };
  }, [client, requested, supported, online, attempt, current]);
  return {
    sessionId: supported ? current?.sessionId : requested,
    managed: supported && current?.managed === true,
    error: current?.error,
    retry,
  };
}
