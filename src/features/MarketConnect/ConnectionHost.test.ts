// @vitest-environment jsdom
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildSettingsPath } from "@src/config/mainAppPaths/settings";
import { ROUTES } from "@src/config/routes";

import ConnectionHost from "./ConnectionHost";
import {
  MARKET_AUTHORIZATION_SAVED_EVENT,
  MARKET_CONNECTION_OPEN_EVENT,
} from "./events";

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("@src/hooks/navigation/useAppNavigate", () => ({
  useAppNavigate: () => mocks.navigate,
}));
const base = {
  identity_user_id: "11111111-1111-4111-8111-111111111111",
  workspace_id: "ws_test",
};
let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(ConnectionHost)));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  mocks.navigate.mockReset();
  vi.unstubAllGlobals();
});

describe("Market connection navigation", () => {
  it.each([MARKET_AUTHORIZATION_SAVED_EVENT, MARKET_CONNECTION_OPEN_EVENT])(
    "returns native ORG2 profiles directly to Workstation for %s",
    (type) => {
      act(() => {
        window.dispatchEvent(
          new CustomEvent(type, { detail: { ...base, target: "org2" } })
        );
      });
      expect(mocks.navigate).toHaveBeenCalledWith(ROUTES.workStation.base.path);
    }
  );

  it.each(["claude-code", "claude-app", "codex"] as const)(
    "keeps %s in the external app configuration surface",
    (target) => {
      act(() => {
        window.dispatchEvent(
          new CustomEvent(MARKET_CONNECTION_OPEN_EVENT, {
            detail: { ...base, target },
          })
        );
      });
      expect(mocks.navigate).toHaveBeenCalledWith(
        buildSettingsPath({ section: "harness-connections" })
      );
    }
  );

  it("ignores malformed event payloads", () => {
    act(() => {
      window.dispatchEvent(
        new CustomEvent(MARKET_CONNECTION_OPEN_EVENT, {
          detail: { ...base, target: "browser" },
        })
      );
    });
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
