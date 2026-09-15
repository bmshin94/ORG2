// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsTab, resolvePermissionTierLabel } from "./SettingsTab";

const mocks = vi.hoisted(() => ({
  signOut: vi.fn(),
  navigate: vi.fn(),
  bypass: false,
  connection: {
    status: "connected",
    presence: "online",
    desktopName: "Home Mac",
    tier: "full",
    demoMode: false,
  },
  config: {
    wsUrl:
      "wss://name:password@relay.example.test/v1/mobile/ws?ticket=secret#pairing",
  },
}));
vi.mock("../../platform", () => ({
  useMobileRemotePlatform: () => ({ openExternal: mocks.navigate }),
}));
vi.mock("../../app", () => ({
  useMobileRemote: () => ({
    connection: mocks.connection,
    connectionConfig: mocks.config,
  }),
}));
vi.mock("../../auth/MobileAuthContext", () => ({
  useMobileAuth: () => ({
    session: {
      userId: "user-a",
      profile: { primaryEmail: "mobile@example.test" },
    },
    signOut: mocks.signOut,
    isDevelopmentBypass: mocks.bypass,
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const env = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
let previousAct: boolean | undefined;
function dialog() {
  return document.querySelector<HTMLElement>('[role="dialog"]');
}
function button(label: string, scope: ParentNode = dialog() ?? host) {
  const result = Array.from(
    scope.querySelectorAll<HTMLButtonElement>("button")
  ).find(
    (item) =>
      item.getAttribute("aria-label") === label || item.textContent === label
  );
  expect(result, label).toBeTruthy();
  return result!;
}
async function click(label: string, scope?: ParentNode) {
  await act(async () => button(label, scope).click());
}
async function render(props = {}) {
  await act(async () => root.render(React.createElement(SettingsTab, props)));
}
beforeEach(() => {
  previousAct = env.IS_REACT_ACT_ENVIRONMENT;
  env.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  mocks.navigate.mockReset().mockResolvedValue(undefined);
  mocks.signOut.mockReset();
  mocks.bypass = false;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  await act(async () => vi.advanceTimersByTime(1));
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
  env.IS_REACT_ACT_ENVIRONMENT = previousAct;
});

describe("SettingsTab shared account destination", () => {
  it("opens actual Profile, supports help/back and restores the Settings trigger on Escape", async () => {
    await render();
    expect(host.textContent).toContain("mobile@example.test");
    for (const key of [
      "settings.signOut",
      "settings.deleteAccount",
      "settings.privacyPolicy",
    ])
      expect(host.textContent).not.toContain(key);
    const trigger = button("profile.open", host);
    trigger.focus();
    await click("profile.open", host);
    await act(async () => vi.advanceTimersByTime(100));
    expect(dialog()?.getAttribute("aria-label")).toBe("profile.title");
    expect(document.activeElement).toBe(button("profile.close"));
    await click("profile.help");
    expect(document.activeElement).toBe(button("profile.back"));
    await click("profile.back");
    expect(dialog()?.textContent).toContain("mobile@example.test");
    await act(async () =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      )
    );
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(host.textContent).toContain("Home Mac");
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it("retains shared confirmation: cancel returns to Profile, confirmed signout fires once after cleanup", async () => {
    await render();
    await click("profile.open", host);
    await click("settings.signOut");
    expect(dialog()?.getAttribute("aria-label")).toBe(
      "settings.signOutConfirmTitle"
    );
    expect(mocks.signOut).not.toHaveBeenCalled();
    await click("settings.cancel");
    expect(dialog()?.getAttribute("aria-label")).toBe("profile.title");
    await click("settings.signOut");
    mocks.signOut.mockImplementation(() => {
      expect(dialog()).toBeNull();
      expect(document.body.style.overflow).toBe("");
    });
    const confirm = button("settings.signOut");
    await act(async () => {
      confirm.click();
      confirm.click();
    });
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });
  it("keeps web actions in Profile with retry and no local account deletion", async () => {
    await render();
    await click("profile.open", host);
    mocks.navigate.mockRejectedValueOnce(new Error("private failure"));
    await click("settings.manageAccount");
    expect(dialog()?.textContent).toContain("settings.openFailed");
    await click("settings.deleteAccount");
    expect(dialog()?.textContent).not.toContain("settings.openFailed");
    expect(dialog()?.textContent).toContain("profile.deleteHint");
    await click("settings.privacyPolicy");
    expect(mocks.navigate.mock.calls.map(([url]) => url)).toEqual([
      "https://org2-cloud-infra.vercel.app/account",
      "https://org2-cloud-infra.vercel.app/account",
      "https://org2-cloud-infra.vercel.app/legal/privacy",
    ]);
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(dialog()?.querySelectorAll(".mobile-profile-group")).toHaveLength(3);
  });
  it("keeps desktop and permissions without a connection-details entry or hidden endpoint", async () => {
    const original = mocks.config.wsUrl;
    await render();
    expect(host.textContent).toContain("Home Mac · settings.online");
    expect(host.textContent).toContain("settings.permissionFull");
    expect(host.textContent).not.toContain("settings.connectionDetails");
    expect(host.textContent).not.toContain("settings.relay");
    expect(host.textContent).not.toContain("settings.mode");
    expect(host.innerHTML).not.toMatch(
      /relay.example.test|password|ticket=secret|#pairing/
    );
    const connection = host.querySelector(
      '[data-testid="mobile-remote-connection-settings"]'
    )!;
    expect(connection.querySelector("button")).toBeNull();
    expect(mocks.config.wsUrl).toBe(original);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it("places optional revoke in authorization, not help, and never renders an unwired action", async () => {
    await render();
    expect(host.textContent).not.toContain("settings.revokePairing");
    const onRevokePairing = vi.fn(),
      onOpenPairingGuide = vi.fn();
    await render({ onRevokePairing, onOpenPairingGuide });
    expect(
      host.querySelector('[data-testid="mobile-remote-authorization-settings"]')
        ?.textContent
    ).toContain("settings.revokePairing");
    expect(
      host.querySelector('[data-testid="mobile-remote-help-settings"]')
        ?.textContent
    ).not.toContain("settings.revokePairing");
    await click("settings.revokePairing", host);
    expect(onRevokePairing).toHaveBeenCalledTimes(1);
    expect(onOpenPairingGuide).not.toHaveBeenCalled();
  });
  it("supports Profile/help in development bypass without fake account actions", async () => {
    mocks.bypass = true;
    await render();
    await click("profile.open", host);
    expect(dialog()?.textContent).toContain("profile.development");
    for (const key of [
      "settings.signOut",
      "settings.deleteAccount",
      "settings.manageAccount",
    ])
      expect(dialog()?.textContent).not.toContain(key);
    await click("profile.help");
    expect(dialog()?.textContent).toContain("profile.connectionHelp");
  });
  it("localizes protocol permissions", () => {
    expect(resolvePermissionTierLabel("full", (key) => key)).toBe(
      "settings.permissionFull"
    );
    expect(resolvePermissionTierLabel("read_only", (key) => key)).toBe(
      "settings.permissionReadOnly"
    );
  });
});
