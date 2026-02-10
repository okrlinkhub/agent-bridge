import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  agents: defineTable({
    name: v.string(),
    appKey: v.optional(v.string()),
    apiKeyHash: v.string(),
    enabled: v.boolean(),
    rateLimit: v.number(),
    lastUsed: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_apiKeyHash", ["apiKeyHash"])
    .index("by_appKey", ["appKey"])
    .index("by_enabled", ["enabled"]),

  agentPermissions: defineTable({
    agentId: v.id("agents"),
    functionPattern: v.string(),
    permission: v.union(
      v.literal("allow"),
      v.literal("deny"),
      v.literal("rate_limited"),
    ),
    rateLimitConfig: v.optional(
      v.object({
        requestsPerHour: v.number(),
        tokenBudget: v.optional(v.number()),
      }),
    ),
    updatedAt: v.number(),
  }).index("by_agentId", ["agentId"]),

  agentFunctions: defineTable({
    key: v.string(),
    enabled: v.boolean(),
    globalRateLimit: v.optional(v.number()),
  }).index("by_key", ["key"]),

  agentLogs: defineTable({
    agentId: v.id("agents"),
    serviceId: v.optional(v.string()),
    functionKey: v.string(),
    args: v.any(),
    result: v.optional(v.any()),
    error: v.optional(v.string()),
    errorCode: v.optional(v.string()),
    duration: v.number(),
    linkedProvider: v.optional(v.string()),
    providerUserIdHash: v.optional(v.string()),
    appUserSubjectHash: v.optional(v.string()),
    linkStatus: v.optional(v.string()),
    rateLimited: v.optional(v.boolean()),
    timestamp: v.number(),
  })
    .index("by_agentId_and_timestamp", ["agentId", "timestamp"])
    .index("by_serviceId_and_timestamp", ["serviceId", "timestamp"])
    .index("by_functionKey", ["functionKey"])
    .index("by_timestamp", ["timestamp"]),

  agentUserLinks: defineTable({
    provider: v.string(),
    providerUserId: v.string(),
    appKey: v.string(),
    appUserSubject: v.string(),
    status: v.union(v.literal("active"), v.literal("revoked"), v.literal("expired")),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    metadata: v.optional(v.any()),
    refreshTokenCiphertext: v.optional(v.string()),
    refreshTokenExpiresAt: v.optional(v.number()),
    tokenVersion: v.optional(v.number()),
  })
    .index("by_provider_providerUserId_appKey", [
      "provider",
      "providerUserId",
      "appKey",
    ])
    .index("by_appKey_status", ["appKey", "status"])
    .index("by_appUserSubject_appKey", ["appUserSubject", "appKey"]),

  agentLinkRateLimits: defineTable({
    key: v.string(),
    bucketStartMs: v.number(),
    requestCount: v.number(),
    updatedAt: v.number(),
  }).index("by_key_bucketStartMs", ["key", "bucketStartMs"]),
});
