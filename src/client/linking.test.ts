import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { components, initConvexTest } from "./setup.test.js";

describe("component linking lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T10:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("upsert + resolve are idempotent and appKey scoped", async () => {
    const t = initConvexTest();

    const first = await t.mutation(components.agentBridge.linking.upsertLink, {
      provider: "discord",
      providerUserId: "user-123",
      appKey: "CRM",
      appUserSubject: "convex-user-a",
      expiresInDays: 30,
      metadata: { source: "discord-command" },
    });
    expect(first.created).toBe(true);

    const second = await t.mutation(components.agentBridge.linking.upsertLink, {
      provider: "discord",
      providerUserId: "user-123",
      appKey: "crm",
      appUserSubject: "convex-user-b",
      expiresInDays: 30,
    });
    expect(second.created).toBe(false);
    expect(second.linkId).toBe(first.linkId);

    const resolved = await t.mutation(components.agentBridge.linking.resolveLink, {
      provider: "discord",
      providerUserId: "user-123",
      appKey: "crm",
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      throw new Error("Expected resolve to succeed");
    }
    expect(resolved.link.appUserSubject).toBe("convex-user-b");

    const wrongApp = await t.mutation(components.agentBridge.linking.resolveLink, {
      provider: "discord",
      providerUserId: "user-123",
      appKey: "billing",
    });
    expect(wrongApp.ok).toBe(false);
    if (wrongApp.ok) {
      throw new Error("Expected app scoped lookup to fail");
    }
    expect(wrongApp.errorCode).toBe("link_not_found");
  });

  test("revoke marks link as revoked", async () => {
    const t = initConvexTest();
    const created = await t.mutation(components.agentBridge.linking.upsertLink, {
      provider: "telegram",
      providerUserId: "tg-77",
      appKey: "crm",
      appUserSubject: "convex-user-77",
    });

    const revokeResult = await t.mutation(components.agentBridge.linking.revokeLink, {
      linkId: created.linkId,
    });
    expect(revokeResult.revoked).toBe(true);

    const resolved = await t.mutation(components.agentBridge.linking.resolveLink, {
      provider: "telegram",
      providerUserId: "tg-77",
      appKey: "crm",
    });
    expect(resolved.ok).toBe(false);
    if (resolved.ok) {
      throw new Error("Expected revoked link to fail");
    }
    expect(resolved.errorCode).toBe("link_revoked");
    expect(resolved.statusCode).toBe(410);
  });

  test("expired links are detected and converted to expired status", async () => {
    const t = initConvexTest();
    await t.mutation(components.agentBridge.linking.upsertLink, {
      provider: "discord",
      providerUserId: "exp-1",
      appKey: "crm",
      appUserSubject: "convex-user-exp",
      expiresInDays: 1,
    });

    vi.setSystemTime(new Date("2026-01-03T10:00:00.000Z"));
    const resolved = await t.mutation(components.agentBridge.linking.resolveLink, {
      provider: "discord",
      providerUserId: "exp-1",
      appKey: "crm",
    });

    expect(resolved.ok).toBe(false);
    if (resolved.ok) {
      throw new Error("Expected expired link to fail");
    }
    expect(resolved.errorCode).toBe("link_expired");
    expect(resolved.statusCode).toBe(410);
  });

  test("resolveLink applies per-link rate limiting", async () => {
    const t = initConvexTest();
    await t.mutation(components.agentBridge.linking.upsertLink, {
      provider: "discord",
      providerUserId: "rl-1",
      appKey: "crm",
      appUserSubject: "convex-user-rl",
    });

    const first = await t.mutation(components.agentBridge.linking.resolveLink, {
      provider: "discord",
      providerUserId: "rl-1",
      appKey: "crm",
      maxRequestsPerWindow: 1,
      windowSeconds: 60,
    });
    expect(first.ok).toBe(true);

    const second = await t.mutation(components.agentBridge.linking.resolveLink, {
      provider: "discord",
      providerUserId: "rl-1",
      appKey: "crm",
      maxRequestsPerWindow: 1,
      windowSeconds: 60,
    });
    expect(second.ok).toBe(false);
    if (second.ok) {
      throw new Error("Expected second resolve to be rate limited");
    }
    expect(second.errorCode).toBe("link_rate_limited");
    expect(second.statusCode).toBe(429);
    expect(second.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });
});
