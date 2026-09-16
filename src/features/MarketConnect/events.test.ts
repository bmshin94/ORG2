// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import {
  MARKET_AUTHORIZATION_SAVED_EVENT,
  MARKET_CONNECTION_ERROR_EVENT,
  MARKET_PROFILES_CHANGED_EVENT,
  classifyMarketConnectionError,
  dispatchMarketConnection,
  dispatchMarketConnectionError,
  parseMarketTarget,
} from "./events";

const connection = {
  identity_user_id: "11111111-1111-4111-8111-111111111111",
  workspace_id: "ws_test",
  target: "org2" as const,
};

describe("Market connection events", () => {
  it("invalidates native profiles only for an ORG2 connection", () => {
    const authorization = vi.fn();
    const profiles = vi.fn();
    window.addEventListener(MARKET_AUTHORIZATION_SAVED_EVENT, authorization);
    window.addEventListener(MARKET_PROFILES_CHANGED_EVENT, profiles);
    try {
      dispatchMarketConnection(MARKET_AUTHORIZATION_SAVED_EVENT, connection);
      expect(authorization).toHaveBeenCalledOnce();
      expect(profiles).toHaveBeenCalledOnce();
      expect(profiles.mock.calls[0]?.[0]).toMatchObject({
        detail: connection,
      });

      dispatchMarketConnection(MARKET_AUTHORIZATION_SAVED_EVENT, {
        ...connection,
        target: "codex",
      });
      expect(authorization).toHaveBeenCalledTimes(2);
      expect(profiles).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener(
        MARKET_AUTHORIZATION_SAVED_EVENT,
        authorization
      );
      window.removeEventListener(MARKET_PROFILES_CHANGED_EVENT, profiles);
    }
  });

  it("publishes bounded error categories instead of raw native failures", () => {
    const listener = vi.fn();
    window.addEventListener(MARKET_CONNECTION_ERROR_EVENT, listener);
    try {
      dispatchMarketConnectionError(
        new Error("market_request_failed secret=must-not-leak"),
        "load-profiles",
        "org2"
      );
      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0]?.[0]).toMatchObject({
        detail: {
          code: "network-unavailable",
          operation: "load-profiles",
          target: "org2",
        },
      });
      expect(JSON.stringify(listener.mock.calls[0]?.[0])).not.toContain(
        "must-not-leak"
      );
    } finally {
      window.removeEventListener(MARKET_CONNECTION_ERROR_EVENT, listener);
    }
  });

  it("classifies recovery states and accepts only known targets", () => {
    expect(classifyMarketConnectionError("credential_store_read_failed")).toBe(
      "authorization-required"
    );
    expect(classifyMarketConnectionError("browser_open_failed")).toBe(
      "browser-open-failed"
    );
    expect(
      classifyMarketConnectionError("market_connection_index_invalid")
    ).toBe("local-state-unavailable");
    expect(parseMarketTarget("claude-code")).toBe("claude-code");
    expect(parseMarketTarget("org2")).toBe("org2");
    expect(parseMarketTarget("https://evil.invalid")).toBeUndefined();
  });
});
