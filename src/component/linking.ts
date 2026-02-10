import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server.js";
import { normalizeAppKey } from "./agentBridgeUtils.js";

const linkStatusValidator = v.union(
  v.literal("active"),
  v.literal("revoked"),
  v.literal("expired"),
);

const linkRecordValidator = v.object({
  _id: v.id("agentUserLinks"),
  _creationTime: v.number(),
  provider: v.string(),
  providerUserId: v.string(),
  appKey: v.string(),
  appUserSubject: v.string(),
  status: linkStatusValidator,
  createdAt: v.number(),
  updatedAt: v.number(),
  lastUsedAt: v.optional(v.number()),
  expiresAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()),
  metadata: v.optional(v.any()),
  refreshTokenCiphertext: v.optional(v.string()),
  refreshTokenExpiresAt: v.optional(v.number()),
  tokenVersion: v.optional(v.number()),
});

const resolveLinkResultValidator = v.union(
  v.object({
    ok: v.literal(true),
    link: linkRecordValidator,
  }),
  v.object({
    ok: v.literal(false),
    errorCode: v.union(
      v.literal("link_not_found"),
      v.literal("link_revoked"),
      v.literal("link_expired"),
      v.literal("link_rate_limited"),
    ),
    statusCode: v.number(),
    retryAfterSeconds: v.optional(v.number()),
  }),
);

function normalizeIdentity(input: string): string {
  return input.trim();
}

function normalizeProvider(provider: string): string {
  return provider.trim().toLowerCase();
}

function resolveExpiresAt(now: number, ttlDays?: number): number | undefined {
  if (ttlDays === undefined) {
    return undefined;
  }
  if (!Number.isFinite(ttlDays) || ttlDays <= 0) {
    throw new Error("expiresInDays must be a positive number");
  }
  return now + Math.floor(ttlDays * 24 * 60 * 60 * 1000);
}

async function checkAndConsumeRateLimit(args: {
  ctx: MutationCtx;
  key: string;
  now: number;
  maxRequests: number;
  windowSeconds: number;
}) {
  const bucketStartMs =
    Math.floor(args.now / (args.windowSeconds * 1000)) * args.windowSeconds * 1000;
  const existing = await args.ctx.db
    .query("agentLinkRateLimits")
    .withIndex("by_key_bucketStartMs", (q) =>
      q.eq("key", args.key).eq("bucketStartMs", bucketStartMs),
    )
    .unique();
  if (existing && existing.requestCount >= args.maxRequests) {
    const nextBucketStartMs = bucketStartMs + args.windowSeconds * 1000;
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((nextBucketStartMs - args.now) / 1000),
    );
    return {
      limited: true as const,
      retryAfterSeconds,
    };
  }
  if (existing) {
    await args.ctx.db.patch(existing._id, {
      requestCount: existing.requestCount + 1,
      updatedAt: args.now,
    });
  } else {
    await args.ctx.db.insert("agentLinkRateLimits", {
      key: args.key,
      bucketStartMs,
      requestCount: 1,
      updatedAt: args.now,
    });
  }
  return { limited: false as const };
}

export const upsertLink = mutation({
  args: {
    provider: v.string(),
    providerUserId: v.string(),
    appKey: v.string(),
    appUserSubject: v.string(),
    expiresInDays: v.optional(v.number()),
    metadata: v.optional(v.any()),
    refreshTokenCiphertext: v.optional(v.string()),
    refreshTokenExpiresAt: v.optional(v.number()),
    tokenVersion: v.optional(v.number()),
  },
  returns: v.object({
    linkId: v.id("agentUserLinks"),
    created: v.boolean(),
    expiresAt: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const provider = normalizeProvider(args.provider);
    const providerUserId = normalizeIdentity(args.providerUserId);
    const appKey = normalizeAppKey(args.appKey);
    const appUserSubject = normalizeIdentity(args.appUserSubject);
    const expiresAt = resolveExpiresAt(now, args.expiresInDays);
    const existing = await ctx.db
      .query("agentUserLinks")
      .withIndex("by_provider_providerUserId_appKey", (q) =>
        q
          .eq("provider", provider)
          .eq("providerUserId", providerUserId)
          .eq("appKey", appKey),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        appUserSubject,
        status: "active",
        updatedAt: now,
        lastUsedAt: existing.lastUsedAt,
        expiresAt,
        revokedAt: undefined,
        metadata: args.metadata,
        refreshTokenCiphertext: args.refreshTokenCiphertext,
        refreshTokenExpiresAt: args.refreshTokenExpiresAt,
        tokenVersion: args.tokenVersion ?? existing.tokenVersion ?? 1,
      });
      return {
        linkId: existing._id,
        created: false,
        expiresAt,
      };
    }

    const linkId = await ctx.db.insert("agentUserLinks", {
      provider,
      providerUserId,
      appKey,
      appUserSubject,
      status: "active",
      createdAt: now,
      updatedAt: now,
      expiresAt,
      metadata: args.metadata,
      refreshTokenCiphertext: args.refreshTokenCiphertext,
      refreshTokenExpiresAt: args.refreshTokenExpiresAt,
      tokenVersion: args.tokenVersion ?? 1,
    });

    return {
      linkId,
      created: true,
      expiresAt,
    };
  },
});

export const resolveLink = mutation({
  args: {
    provider: v.string(),
    providerUserId: v.string(),
    appKey: v.string(),
    maxRequestsPerWindow: v.optional(v.number()),
    windowSeconds: v.optional(v.number()),
    extendExpiryDaysOnUse: v.optional(v.number()),
  },
  returns: resolveLinkResultValidator,
  handler: async (ctx, args) => {
    const now = Date.now();
    const provider = normalizeProvider(args.provider);
    const providerUserId = normalizeIdentity(args.providerUserId);
    const appKey = normalizeAppKey(args.appKey);

    const maxRequestsPerWindow = args.maxRequestsPerWindow ?? 60;
    const windowSeconds = args.windowSeconds ?? 60;
    if (maxRequestsPerWindow <= 0 || windowSeconds <= 0) {
      throw new Error("maxRequestsPerWindow and windowSeconds must be positive");
    }
    const rateLimitKey = `${provider}:${providerUserId}:${appKey}`;
    const rateLimitResult = await checkAndConsumeRateLimit({
      ctx,
      key: rateLimitKey,
      now,
      maxRequests: maxRequestsPerWindow,
      windowSeconds,
    });
    if (rateLimitResult.limited) {
      return {
        ok: false as const,
        errorCode: "link_rate_limited" as const,
        statusCode: 429,
        retryAfterSeconds: rateLimitResult.retryAfterSeconds,
      };
    }

    const link = await ctx.db
      .query("agentUserLinks")
      .withIndex("by_provider_providerUserId_appKey", (q) =>
        q
          .eq("provider", provider)
          .eq("providerUserId", providerUserId)
          .eq("appKey", appKey),
      )
      .unique();
    if (!link) {
      return {
        ok: false as const,
        errorCode: "link_not_found" as const,
        statusCode: 404,
      };
    }
    if (link.status === "revoked") {
      return {
        ok: false as const,
        errorCode: "link_revoked" as const,
        statusCode: 410,
      };
    }
    if (link.expiresAt !== undefined && now > link.expiresAt) {
      await ctx.db.patch(link._id, {
        status: "expired",
        updatedAt: now,
      });
      const expiredLink = await ctx.db.get(link._id);
      if (!expiredLink) {
        return {
          ok: false as const,
          errorCode: "link_expired" as const,
          statusCode: 410,
        };
      }
      return {
        ok: false as const,
        errorCode: "link_expired" as const,
        statusCode: 410,
      };
    }

    const patch: {
      updatedAt: number;
      lastUsedAt: number;
      expiresAt?: number;
    } = {
      updatedAt: now,
      lastUsedAt: now,
    };
    if (args.extendExpiryDaysOnUse !== undefined) {
      patch.expiresAt = resolveExpiresAt(now, args.extendExpiryDaysOnUse);
    }
    await ctx.db.patch(link._id, patch);
    const updated = await ctx.db.get(link._id);
    if (!updated) {
      throw new Error("Link not found after update");
    }

    return {
      ok: true as const,
      link: updated,
    };
  },
});

export const revokeLink = mutation({
  args: {
    linkId: v.optional(v.id("agentUserLinks")),
    provider: v.optional(v.string()),
    providerUserId: v.optional(v.string()),
    appKey: v.optional(v.string()),
  },
  returns: v.object({
    revoked: v.boolean(),
    linkId: v.optional(v.id("agentUserLinks")),
  }),
  handler: async (ctx, args) => {
    let linkId = args.linkId;
    if (!linkId) {
      const provider = args.provider ? normalizeProvider(args.provider) : undefined;
      const providerUserId = args.providerUserId
        ? normalizeIdentity(args.providerUserId)
        : undefined;
      const appKey = args.appKey ? normalizeAppKey(args.appKey) : undefined;
      if (!provider || !providerUserId || !appKey) {
        throw new Error(
          "Provide either linkId or provider, providerUserId and appKey",
        );
      }
      const existing = await ctx.db
        .query("agentUserLinks")
        .withIndex("by_provider_providerUserId_appKey", (q) =>
          q
            .eq("provider", provider)
            .eq("providerUserId", providerUserId)
            .eq("appKey", appKey),
        )
        .unique();
      if (!existing) {
        return { revoked: false };
      }
      linkId = existing._id;
    }

    const existing = await ctx.db.get(linkId);
    if (!existing) {
      return { revoked: false };
    }
    await ctx.db.patch(linkId, {
      status: "revoked",
      revokedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return {
      revoked: true,
      linkId,
    };
  },
});

export const listLinks = query({
  args: {
    appKey: v.optional(v.string()),
    provider: v.optional(v.string()),
    status: v.optional(linkStatusValidator),
    limit: v.optional(v.number()),
  },
  returns: v.array(linkRecordValidator),
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 100, 500);
    if (args.appKey && args.status) {
      return await ctx.db
        .query("agentUserLinks")
        .withIndex("by_appKey_status", (q) =>
          q.eq("appKey", normalizeAppKey(args.appKey!)).eq("status", args.status!),
        )
        .order("desc")
        .take(limit);
    }
    const all = await ctx.db.query("agentUserLinks").order("desc").take(limit);
    return all.filter((link) => {
      if (args.provider && link.provider !== normalizeProvider(args.provider)) {
        return false;
      }
      if (args.appKey && link.appKey !== normalizeAppKey(args.appKey)) {
        return false;
      }
      if (args.status && link.status !== args.status) {
        return false;
      }
      return true;
    });
  },
});
