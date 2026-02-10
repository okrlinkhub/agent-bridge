import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import {
  findBestPermissionMatch,
  hashApiKey,
  type PermissionType,
} from "./agentBridgeUtils.js";

const authorizeResultValidator = v.union(
  v.object({
    authorized: v.literal(true),
    agentId: v.id("agents"),
  }),
  v.object({
    authorized: v.literal(false),
    error: v.string(),
    statusCode: v.number(),
    agentId: v.optional(v.id("agents")),
    retryAfterSeconds: v.optional(v.number()),
  }),
);

/**
 * Authorize an agent request.
 * This is a mutation (not a query) because it updates counters and last activity.
 *
 * Steps:
 * 1. Validate API key
 * 2. Check agent is active
 * 3. Check function permissions
 * 4. Check function global override
 * 5. Check rate limits
 *
 * Returns the agent id if authorized, or an error.
 */
export const authorizeRequest = mutation({
  args: {
    apiKey: v.string(),
    functionKey: v.string(),
    estimatedCost: v.optional(v.number()),
  },
  returns: authorizeResultValidator,
  handler: async (ctx, args) => {
    const apiKeyHash = await hashApiKey(args.apiKey);
    const agent = await ctx.db
      .query("agents")
      .withIndex("by_apiKeyHash", (q) => q.eq("apiKeyHash", apiKeyHash))
      .unique();
    if (!agent) {
      return {
        authorized: false as const,
        error: "Invalid API key",
        statusCode: 401,
      };
    }

    if (!agent.enabled) {
      return {
        authorized: false as const,
        error: "Agent disabled",
        statusCode: 403,
        agentId: agent._id,
      };
    }

    const permissions = await ctx.db
      .query("agentPermissions")
      .withIndex("by_agentId", (q) => q.eq("agentId", agent._id))
      .collect();
    const matchedRule = findBestPermissionMatch(args.functionKey, permissions);
    if (!matchedRule || matchedRule.permission === "deny") {
      return {
        authorized: false as const,
        error: `Function ${args.functionKey} not allowed`,
        statusCode: 403,
        agentId: agent._id,
      };
    }

    const functionOverride = await ctx.db
      .query("agentFunctions")
      .withIndex("by_key", (q) => q.eq("key", args.functionKey))
      .unique();
    if (functionOverride && !functionOverride.enabled) {
      return {
        authorized: false as const,
        error: `Function ${args.functionKey} disabled`,
        statusCode: 403,
        agentId: agent._id,
      };
    }

    const effectiveHourlyLimit = resolveEffectiveHourlyLimit(
      agent.rateLimit,
      matchedRule.permission,
      matchedRule.rateLimitConfig?.requestsPerHour,
      functionOverride?.globalRateLimit,
    );
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const recentLogs = await ctx.db
      .query("agentLogs")
      .withIndex("by_agentId_and_timestamp", (q) => q.eq("agentId", agent._id))
      .collect();
    const recentCallCount = recentLogs.filter(
      (log) => log.timestamp >= oneHourAgo,
    ).length;
    if (recentCallCount >= effectiveHourlyLimit) {
      return {
        authorized: false as const,
        error: "Rate limit exceeded",
        statusCode: 429,
        retryAfterSeconds: 3600,
        agentId: agent._id,
      };
    }

    if (
      matchedRule.permission === "rate_limited" &&
      matchedRule.rateLimitConfig?.tokenBudget !== undefined
    ) {
      const estimatedCost = args.estimatedCost ?? 0;
      const tokenEstimate = recentLogs
        .filter((log) => log.timestamp >= oneHourAgo)
        .reduce((sum, log) => sum + estimateCostFromLog(log.args), 0);
      if (tokenEstimate + estimatedCost > matchedRule.rateLimitConfig.tokenBudget) {
        return {
          authorized: false as const,
          error: "Token budget exceeded",
          statusCode: 429,
          retryAfterSeconds: 3600,
          agentId: agent._id,
        };
      }
    }

    await ctx.db.patch(agent._id, {
      lastUsed: Date.now(),
    });

    return {
      authorized: true as const,
      agentId: agent._id,
    };
  },
});

/**
 * Log an access attempt to the audit log.
 * Called after function execution (success or failure).
 */
export const logAccess = mutation({
  args: {
    agentId: v.id("agents"),
    functionKey: v.string(),
    args: v.any(),
    result: v.optional(v.any()),
    error: v.optional(v.string()),
    duration: v.number(),
    timestamp: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("agentLogs", {
      timestamp: args.timestamp,
      agentId: args.agentId,
      functionKey: args.functionKey,
      args: args.args,
      result: args.result,
      error: args.error,
      duration: args.duration,
    });
    return null;
  },
});

/**
 * Query access logs for audit purposes.
 */
export const queryAccessLog = query({
  args: {
    agentId: v.optional(v.id("agents")),
    functionKey: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("agentLogs"),
      timestamp: v.number(),
      agentId: v.id("agents"),
      functionKey: v.string(),
      args: v.any(),
      result: v.optional(v.any()),
      error: v.optional(v.string()),
      duration: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    const agentId = args.agentId;
    if (agentId !== undefined) {
      const logs = await ctx.db
        .query("agentLogs")
        .withIndex("by_agentId_and_timestamp", (q) =>
          q.eq("agentId", agentId),
        )
        .order("desc")
        .take(limit);

      return logs.map((l) => ({
        _id: l._id,
        timestamp: l.timestamp,
        agentId: l.agentId,
        functionKey: l.functionKey,
        args: l.args,
        result: l.result,
        error: l.error,
        duration: l.duration,
      }));
    }

    const logs = await ctx.db
      .query("agentLogs")
      .order("desc")
      .take(limit);
    const filteredLogs =
      args.functionKey !== undefined
        ? logs.filter((log) => log.functionKey === args.functionKey)
        : logs;

    return filteredLogs.map((l) => ({
      _id: l._id,
      timestamp: l.timestamp,
      agentId: l.agentId,
      functionKey: l.functionKey,
      args: l.args,
      result: l.result,
      error: l.error,
      duration: l.duration,
    }));
  },
});

function resolveEffectiveHourlyLimit(
  baseAgentLimit: number,
  permissionType: PermissionType,
  permissionLimit?: number,
  globalLimit?: number,
) {
  let effective = baseAgentLimit;
  if (permissionType === "rate_limited" && permissionLimit !== undefined) {
    effective = Math.min(effective, permissionLimit);
  }
  if (globalLimit !== undefined) {
    effective = Math.min(effective, globalLimit);
  }
  return effective;
}

function estimateCostFromLog(args: unknown): number {
  if (!args || typeof args !== "object") {
    return 0;
  }
  if ("estimatedCost" in args && typeof args.estimatedCost === "number") {
    return args.estimatedCost;
  }
  return 0;
}
