import type { MobileRpcClient } from "./mobileRpcClient";

export interface MobileSessionIdentity {
  sessionId: string;
  managed: boolean;
}

const MAX_IDENTITIES = 32;
const MAX_PENDING_IDENTITIES = 8;
const IDENTITY_TTL_MS = 5 * 60_000;

type Cache = {
  generation: number;
  resolved: Map<string, { value: MobileSessionIdentity; expiresAt: number }>;
  pending: Map<
    string,
    { promise: Promise<MobileSessionIdentity>; abort: AbortController }
  >;
};

// The authenticated RPC client is the lifetime and isolation boundary: no disk
// persistence, no session-id-only global cache, and no new network listeners.
const caches = new WeakMap<MobileRpcClient, Cache>();

export class MobileSessionIdentityInvalidated extends Error {
  constructor() {
    super("Session identity was invalidated");
  }
}

export function cachedMobileSessionIdentity(
  client: MobileRpcClient,
  requested: string
): MobileSessionIdentity | undefined {
  const entry = caches.get(client)?.resolved.get(requested);
  return entry && entry.expiresAt > Date.now() ? entry.value : undefined;
}

export function invalidateMobileSessionIdentities(client: MobileRpcClient) {
  const cache = caches.get(client);
  if (!cache) return;
  cache.generation += 1;
  cache.resolved.clear();
  const abandoned = Array.from(cache.pending.values());
  cache.pending.clear();
  for (const flight of abandoned) flight.abort.abort();
}

export function resolveMobileSessionIdentity(
  client: MobileRpcClient,
  requested: string
): Promise<MobileSessionIdentity> {
  let cache = caches.get(client);
  if (!cache) {
    cache = { generation: 0, resolved: new Map(), pending: new Map() };
    caches.set(client, cache);
  }
  const hit = cachedMobileSessionIdentity(client, requested);
  if (hit) return Promise.resolve(hit);
  const pending = cache.pending.get(requested);
  if (pending) return pending.promise;
  if (cache.pending.size >= MAX_PENDING_IDENTITIES) {
    return Promise.reject(
      new Error("Too many pending session identity lookups")
    );
  }
  const owner = cache;
  const generation = owner.generation;
  const abort = new AbortController();
  // Keep a shared request alive across route unmount/remount. Its lifetime is
  // bounded by the RPC timeout and cancelled by connection/list invalidation.
  const promise = Promise.resolve().then(async () => {
    try {
      if (generation !== owner.generation)
        throw new MobileSessionIdentityInvalidated();
      const result = await client.call<{
        sessionId?: unknown;
        managed?: unknown;
      }>("session/resolve", { sessionId: requested }, abort.signal);
      if (generation !== owner.generation)
        throw new MobileSessionIdentityInvalidated();
      if (
        typeof result?.sessionId !== "string" ||
        !result.sessionId.trim() ||
        result.sessionId.length > 256 ||
        typeof result.managed !== "boolean"
      )
        throw new Error("Invalid session identity");
      const value = { sessionId: result.sessionId, managed: result.managed };
      for (const [key, entry] of owner.resolved) {
        if (entry.expiresAt <= Date.now()) owner.resolved.delete(key);
      }
      owner.resolved.delete(requested);
      owner.resolved.set(requested, {
        value,
        expiresAt: Date.now() + IDENTITY_TTL_MS,
      });
      while (owner.resolved.size > MAX_IDENTITIES) {
        owner.resolved.delete(owner.resolved.keys().next().value!);
      }
      return value;
    } catch (error) {
      if (generation !== owner.generation)
        throw new MobileSessionIdentityInvalidated();
      throw error;
    } finally {
      if (owner.pending.get(requested)?.promise === promise)
        owner.pending.delete(requested);
    }
  });
  owner.pending.set(requested, { promise, abort });
  return promise;
}
