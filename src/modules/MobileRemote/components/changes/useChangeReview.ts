import { useEffect, useState } from "react";

import type { MobileRpcClient } from "../../connection/mobileRpcClient";
import { useMobileRemotePlatform } from "../../platform";

export type ChangeScope = "turn" | "session" | "workspace";
export interface ChangeFile {
  path: string;
  additions: number | null;
  deletions: number | null;
  patches: string[];
  before: string | null;
  after: string | null;
  availability: string;
}
export interface Review {
  files: ChangeFile[];
  complete: boolean;
}
export function validateReview(value: unknown): Review {
  const result = value as Review;
  if (
    !result ||
    typeof result.complete !== "boolean" ||
    !Array.isArray(result.files) ||
    result.files.length > 500 ||
    !result.files.every(
      (f) =>
        f &&
        typeof f.path === "string" &&
        f.path.length > 0 &&
        [f.additions, f.deletions].every(
          (n) => n === null || (Number.isSafeInteger(n) && n >= 0)
        ) &&
        [f.before, f.after].every(
          (s) => s === null || (typeof s === "string" && s.length <= 524288)
        ) &&
        Array.isArray(f.patches) &&
        f.patches.every((p) => typeof p === "string") &&
        typeof f.availability === "string"
    ) ||
    JSON.stringify(value).length > 3 * 1024 * 1024
  )
    throw new Error("Invalid change review");
  return result;
}

export function useChangeReview(
  client: MobileRpcClient | null,
  sessionId: string,
  roundId: string | null,
  scope: ChangeScope,
  enabled: boolean,
  revision: string,
  filePath?: string
) {
  const key = JSON.stringify([sessionId, roundId, scope, revision, filePath]);
  const { runtime } = useMobileRemotePlatform();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    client: MobileRpcClient;
    key: string;
    attempt: number;
    value?: Review;
    error?: boolean;
  } | null>(null);
  // File viewers leave the viewport or collapse; do not retain their large
  // snapshots for the lifetime of the entire review panel.
  if (!enabled && state !== null) setState(null);
  useEffect(() => {
    if (!client || !enabled) return;
    const controller = new AbortController();
    const timer = runtime.setTimeout(() => {
      void client
        .call(
          "session/changes",
          { sessionId, roundId, scope, filePath },
          controller.signal
        )
        .then(validateReview)
        .then((value) => {
          if (!controller.signal.aborted)
            setState({ client, key, attempt, value });
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setState({ client, key, attempt, error: true });
        });
    }, 250);
    return () => {
      runtime.clearTimeout(timer);
      controller.abort();
    };
  }, [
    client,
    enabled,
    key,
    sessionId,
    roundId,
    scope,
    filePath,
    attempt,
    runtime,
  ]);
  const current =
    state?.client === client && state.key === key && state.attempt === attempt
      ? state
      : null;
  return {
    value: current?.value,
    error: current?.error,
    retry: () => {
      if (!client || !enabled || !current?.error) return;
      // Invalidate the failed result immediately. Repeated taps from the same
      // render may enqueue updates together; only the first starts a retry.
      setAttempt((pendingAttempt) =>
        pendingAttempt === attempt ? attempt + 1 : pendingAttempt
      );
    },
  };
}
