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
    functionKey: v.string(),
    args: v.any(),
    result: v.optional(v.any()),
    error: v.optional(v.string()),
    duration: v.number(),
    timestamp: v.number(),
  })
    .index("by_agentId_and_timestamp", ["agentId", "timestamp"])
    .index("by_functionKey", ["functionKey"])
    .index("by_timestamp", ["timestamp"]),
});
