import { afterEach, describe, expect, it, vi } from "vitest";

import type { MobileRpcClient } from "./mobileRpcClient";
import {
  MobileSessionIdentityInvalidated,
  cachedMobileSessionIdentity,
  invalidateMobileSessionIdentities,
  resolveMobileSessionIdentity,
} from "./mobileSessionIdentityCache";

function clientWith(
  call = vi.fn().mockResolvedValue({ sessionId: "owner", managed: true })
) {
  return {
    call,
    close: vi.fn(),
    notify: vi.fn(),
    onNotification: () => () => {},
    readyState: 1,
  } satisfies MobileRpcClient;
}

describe("connection-scoped session identity cache", () => {
  afterEach(() => vi.useRealTimers());

  it("shares pending lookups and retains only validated successes for this client", async () => {
    let finish!: (value: unknown) => void;
    const call = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const client = clientWith(call);
    const first = resolveMobileSessionIdentity(client, "mirror");
    const second = resolveMobileSessionIdentity(client, "mirror");
    expect(second).toBe(first);
    await Promise.resolve();
    finish({ sessionId: "owner", managed: true });
    await first;
    expect(cachedMobileSessionIdentity(client, "mirror")).toEqual({
      sessionId: "owner",
      managed: true,
    });
    await resolveMobileSessionIdentity(client, "mirror");
    expect(call).toHaveBeenCalledOnce();
    const other = clientWith();
    expect(cachedMobileSessionIdentity(other, "mirror")).toBeUndefined();
    await resolveMobileSessionIdentity(other, "mirror");
    expect(other.call).toHaveBeenCalledOnce();
  });

  it("does not retain failures or malformed responses", async () => {
    const call = vi
      .fn()
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce({ sessionId: " ", managed: true })
      .mockResolvedValueOnce({ sessionId: "safe", managed: false });
    const client = clientWith(call);
    await expect(resolveMobileSessionIdentity(client, "s")).rejects.toThrow(
      "unavailable"
    );
    await expect(resolveMobileSessionIdentity(client, "s")).rejects.toThrow(
      "Invalid session identity"
    );
    expect(cachedMobileSessionIdentity(client, "s")).toBeUndefined();
    await expect(resolveMobileSessionIdentity(client, "s")).resolves.toEqual({
      sessionId: "safe",
      managed: false,
    });
    expect(call).toHaveBeenCalledTimes(3);
  });

  it("bounds successful entries and expires them lazily without timers", async () => {
    vi.useFakeTimers();
    const client = clientWith();
    for (let index = 0; index < 33; index++)
      await resolveMobileSessionIdentity(client, String(index));
    expect(cachedMobileSessionIdentity(client, "0")).toBeUndefined();
    expect(cachedMobileSessionIdentity(client, "1")).toBeDefined();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(cachedMobileSessionIdentity(client, "32")).toBeUndefined();
    await resolveMobileSessionIdentity(client, "32");
    expect(client.call).toHaveBeenCalledTimes(34);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels invalidated flights and prevents a late result from repopulating the cache", async () => {
    let finishOld!: (value: unknown) => void;
    const call = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = resolve;
          })
      )
      .mockResolvedValueOnce({ sessionId: "new-owner", managed: true });
    const client = clientWith(call);
    const old = resolveMobileSessionIdentity(client, "s");
    const rejected = expect(old).rejects.toBeInstanceOf(
      MobileSessionIdentityInvalidated
    );
    await Promise.resolve();
    const signal = call.mock.calls[0][2] as AbortSignal;
    invalidateMobileSessionIdentities(client);
    expect(signal.aborted).toBe(true);
    await resolveMobileSessionIdentity(client, "s");
    finishOld({ sessionId: "old-owner", managed: true });
    await rejected;
    expect(cachedMobileSessionIdentity(client, "s")?.sessionId).toBe(
      "new-owner"
    );
  });

  it("bounds distinct pending lookups and releases capacity when they settle", async () => {
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    const client = clientWith(vi.fn().mockReturnValue(pending));
    const flights = Array.from({ length: 8 }, (_, index) =>
      resolveMobileSessionIdentity(client, String(index))
    );
    await expect(
      resolveMobileSessionIdentity(client, "overflow")
    ).rejects.toThrow("Too many pending");
    finish({ sessionId: "owner", managed: true });
    await Promise.all(flights);
    await expect(
      resolveMobileSessionIdentity(client, "fresh")
    ).resolves.toEqual({ sessionId: "owner", managed: true });
  });
});
