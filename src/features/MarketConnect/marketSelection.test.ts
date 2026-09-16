import { expect, it } from "vitest";

import type { MarketExecutionProfile } from "./marketProfiles";
import {
  parseAppliedMarketSelection,
  profileForAppliedMarketSelection,
} from "./marketSelection";

const identity = "11111111-1111-7111-8111-111111111111";
const selection = (entitlementId: string) => {
  const json = JSON.stringify({
    metadata: {
      identity_user_id: identity,
      workspace_id: "ws_anchor",
      target: "org2",
    },
    workspace_id: "ws_purchase",
    entitlement_id: entitlementId,
  });
  const encoded = btoa(json)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  return `market:${encoded}`;
};
const profile = (entitlementId: string) =>
  ({
    id: `market:${identity}:${entitlementId}`,
    label: "Same service",
    connection: {
      identity_user_id: identity,
      workspace_id: "ws_anchor",
      target: "org2",
    },
    entitlementWorkspaceId: "ws_purchase",
    entitlementId,
    serviceId: `service-${entitlementId}`,
    modelsByAgent: { claude_code: ["claude"], codex: [] },
    expiresAt: null,
  }) satisfies MarketExecutionProfile;

it("matches the exact entitlement from the applied manifest", () => {
  const first = profile("ent_first");
  const second = profile("ent_second");
  expect(
    profileForAppliedMarketSelection([first, second], selection("ent_second"))
  ).toBe(second);
});

it("rejects malformed and credential-like selections", () => {
  expect(parseAppliedMarketSelection("market:not-base64")).toBeNull();
  expect(
    parseAppliedMarketSelection(
      `market:${btoa(JSON.stringify({ token: "secret" }))}`
    )
  ).toBeNull();
});

it("reads legacy manifests using their original authorization workspace", () => {
  const encoded = `market:${btoa(JSON.stringify({ metadata: { identity_user_id: identity, workspace_id: "ws_original", target: "org2" }, entitlement_id: "ent_original" }))}`;
  expect(parseAppliedMarketSelection(encoded)).toEqual({
    identityUserId: identity,
    workspaceId: "ws_original",
    entitlementId: "ent_original",
  });
});

it("identifies a legacy app-specific purchase for display without changing its identity", () => {
  const entry = profile("ent_old");
  entry.entitlementWorkspaceId = "ws_original";
  const saved = `market:${btoa(JSON.stringify({ metadata: { identity_user_id: identity, workspace_id: "ws_original", target: "claude-code" }, entitlement_id: "ent_old" }))}`;
  expect(profileForAppliedMarketSelection([entry], saved)).toBe(entry);
});
