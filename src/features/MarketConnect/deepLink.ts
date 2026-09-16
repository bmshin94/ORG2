import { openUrl } from "@tauri-apps/plugin-opener";
import { getDefaultStore } from "jotai";
import { z } from "zod/v4";

import { defineProcedure, typedInvoke } from "@src/api/tauri/rpc/invoke";
import Message from "@src/components/Message";
import { decodeJwtSub } from "@src/features/Org2Cloud/authCallback";
import { completeOrg2CloudSignIn } from "@src/features/Org2Cloud/completeSignIn";
import { org2CloudAuthAtom } from "@src/features/Org2Cloud/org2CloudAuthAtom";
import i18n from "@src/i18n";

import {
  MARKET_AUTHORIZATION_SAVED_EVENT,
  MARKET_CONNECTION_OPEN_EVENT,
  classifyMarketConnectionError,
  dispatchMarketConnection,
  dispatchMarketConnectionError,
  parseMarketTarget,
} from "./events";
import { loadConnections, loadEntries } from "./rpc";
import { isMarketAppUrl, isTrustedMarketPage } from "./urlPolicy";

const rawInput = z.object({ raw: z.string().max(2048) });
const begin = defineProcedure("market_connection_begin")
  .input(rawInput)
  .output(z.string().url())
  .build();
const complete = defineProcedure("market_connection_complete")
  .input(rawInput)
  .output(
    z.object({
      identity_user_id: z.string().uuid(),
      workspace_id: z.string().regex(/^ws_[A-Za-z0-9_-]{1,120}$/),
      target: z.enum(["claude-code", "claude-app", "codex", "org2"]),
      phase: z.literal("authorization_saved"),
    })
  )
  .build();
const cancel = defineProcedure("market_connection_cancel").build();

// The existing main-window deep-link owner dispatches both warm and cold links.
// Keep at most one operation; never put authorization URLs in logs or dedup sets.
let busy = false;
let queuedCallback: string | undefined;
const completedAuthorizationStates = new Set<string>();
const MAX_COMPLETED_AUTHORIZATION_STATES = 32;

function authorizationState(url: URL): string | null {
  const state = url.searchParams.get("state");
  return state && /^[A-Za-z0-9_-]{43}$/.test(state) ? state : null;
}

function rememberCompletedAuthorization(state: string | null): void {
  if (!state) return;
  completedAuthorizationStates.add(state);
  while (
    completedAuthorizationStates.size > MAX_COMPLETED_AUTHORIZATION_STATES
  ) {
    const oldest = completedAuthorizationStates.values().next().value;
    if (typeof oldest !== "string") break;
    completedAuthorizationStates.delete(oldest);
  }
}
function cloudSessionFromMarketCallback(url: URL) {
  if (!url.hash) return null;
  const params = new URLSearchParams(url.hash.slice(1));
  const accessToken = params.get("access_token")?.trim();
  const refreshToken = params.get("refresh_token")?.trim();
  const expiresAt = Number(params.get("expires_at"));
  if (
    !accessToken ||
    accessToken.length > 8192 ||
    !refreshToken ||
    refreshToken.length > 4096 ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now() / 1000
  )
    return null;
  return { accessToken, refreshToken, expiresAt };
}
export function handleMarketConnectionUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (!isMarketAppUrl(url)) return false;
  const callbackState =
    url.pathname === "/authorized" ? authorizationState(url) : null;
  // Browsers may leave the verified fallback link visible after the automatic
  // custom-protocol handoff succeeds. Treat a second click as the same local
  // delivery instead of trying to exchange the one-time grant again.
  if (callbackState && completedAuthorizationStates.has(callbackState))
    return true;
  const requestedTarget = parseMarketTarget(url.searchParams.get("target"));
  if (busy) {
    if (raw.length <= 16384 && url.pathname === "/authorized")
      queuedCallback ??= raw;
    return true;
  }
  busy = true;
  const operation =
    url.pathname === "/authorized"
      ? ("complete-authorization" as const)
      : ("begin-authorization" as const);
  (async () => {
    try {
      if (url.pathname === "/connect") {
        if (url.searchParams.get("target") === "org2") {
          const workspace = url.searchParams.get("workspace_id");
          const status = await loadConnections();
          for (const existing of status.connections.filter(
            (connection) =>
              connection.target === "org2" &&
              connection.phase === "authorization_saved"
          )) {
            try {
              const entries = await loadEntries(existing);
              if (
                existing.workspace_id === workspace ||
                entries.some((entry) => entry.workspace_id === workspace)
              ) {
                dispatchMarketConnection(
                  MARKET_CONNECTION_OPEN_EVENT,
                  existing
                );
                return;
              }
            } catch {
              // A stale connection continues through the normal browser
              // authorization path below.
            }
          }
        }
        const authorization = new URL(await typedInvoke(begin, { raw }));
        try {
          if (!isTrustedMarketPage(authorization, "/buyer/connect/authorize")) {
            throw new Error("invalid_authorization_destination");
          }
          await openUrl(authorization.toString());
        } catch {
          await typedInvoke(cancel);
          throw new Error("browser_open_failed");
        }
      } else if (url.pathname === "/authorized") {
        const cloudSession = cloudSessionFromMarketCallback(url);
        url.hash = "";
        const result = await typedInvoke(complete, { raw: url.toString() });
        rememberCompletedAuthorization(callbackState);
        const store = getDefaultStore();
        if (
          result.target === "org2" &&
          cloudSession &&
          decodeJwtSub(cloudSession.accessToken) === result.identity_user_id &&
          store.get(org2CloudAuthAtom) === null
        ) {
          completeOrg2CloudSignIn(cloudSession, (value) =>
            store.set(org2CloudAuthAtom, value)
          );
        }
        dispatchMarketConnection(MARKET_AUTHORIZATION_SAVED_EVENT, result);
        // ORG2-native services become profiles immediately. External clients
        // still need their existing configuration step in App connections.
        if (result.target !== "org2") {
          Message.success(
            i18n.t("integrations:marketConnection.authorizationSaved")
          );
        }
      } else {
        throw new Error("invalid_market_connection_link");
      }
    } catch (error) {
      // Inspect only the known capability code; never display callback/IPC data.
      const code = classifyMarketConnectionError(error);
      dispatchMarketConnectionError(error, operation, requestedTarget);
      Message.error(
        i18n.t(
          code === "secure-storage-unavailable"
            ? "integrations:marketConnection.platformUnavailable"
            : "integrations:marketConnection.failed"
        )
      );
    } finally {
      busy = false;
      const next = queuedCallback;
      queuedCallback = undefined;
      if (next) handleMarketConnectionUrl(next);
    }
  })().catch(() => {
    // Report unexpected UI failures without exposing authorization data.
    console.error("Market connection UI update failed");
  });
  return true;
}
