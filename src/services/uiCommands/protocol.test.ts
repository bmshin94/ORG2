import { describe, expect, it } from "vitest";

import { uiCatalog } from "@src/ActionSystem/publicUi/catalog";

import catalog from "../../../src-tauri/crates/app-ui/catalog.json";
import fixture from "../../../src-tauri/crates/app-ui/protocol.fixture.json";
import { requestSchema } from "./protocol";

describe("UI wire contract", () => {
  it("matches the same fixture Rust serializes", () => {
    expect(requestSchema.parse(fixture)).toEqual(fixture);
    expect(
      requestSchema.safeParse({ ...fixture, invokingSessionId: "forged" })
        .success
    ).toBe(false);
    expect(
      requestSchema.safeParse({
        ...fixture,
        target: { ...fixture.target, station: "unknown" },
      }).success
    ).toBe(false);
  });
  it("keeps the bundled CLI catalog aligned with Zod definitions", () => {
    const { hash, ...bundled } = catalog;
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(bundled).toEqual(uiCatalog);
  });
});
