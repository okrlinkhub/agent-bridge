import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";

// --- Token hashing utility (same as provisioning.ts) ---

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// --- Pattern matching (same logic as permissions.ts) ---

function patternSpecificity(pattern: string): number {
  const wildcardIndex = pattern.indexOf("*");
  if (wildcardIndex === -1) return pattern.length;
  return wildcardIndex;
}

function matchesPattern(functionName: string, pattern: string): boolean {
  if (pattern === "*") return true;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const regexStr = "^" + escaped.replace(/\*/g, ".*") + "$";
  return new RegExp(regexStr).test(functionName);
}

// --- Authorize request result validator ---

const authorizeResultValidator = v.union(
  v.object({
    authorized: v.literal(true),
    agentId: v.string(),
    appName: v.string(),
    functionHandle: v.string(),
    functionType: v.union(
      v.literal("query"),
      v.literal("mutation"),
      v.literal("action"),
    ),
  }),
  v.object({
    authorized: v.literal(false),
    error: v.string(),
    statusCode: v.number(),
    agentId: v.optional(v.string()),
    matchedPattern: v.optional(v.string()),
    matchedPermission: v.optional(
      v.union(
        v.literal("allow"),
        v.literal("deny"),
        v.literal("rate_limited"),
      ),
    ),
  }),
);

/**
 * Authorize an agent request.
 * This is a mutation (not a query) because it updates counters and last activity.
 *
 * Steps:
 * 1. Validate instance token
 * 2. Check agent is active
 * 3. Check function permissions
 * 4. Look up function handle in registry
 * 5. Update activity counters
 *
 * Returns the function handle info if authorized, or an error.
 */
export const authorizeRequest = mutation({
  args: {
    instanceToken: v.string(),
    functionName: v.string(),
    appName: v.string(),
  },
  returns: authorizeResultValidator,
  handler: async (ctx, args) => {
    // 1. Validate instance token
    const tokenHash = await hashToken(args.instanceToken);
    const instance = await ctx.db
      .query("agentAppInstances")
      .withIndex("by_instance_token_hash", (q) =>
        q.eq("instanceTokenHash", tokenHash),
      )
      .unique();

    if (!instance) {
      return {
        authorized: false as const,
        error: "Invalid instance token",
        statusCode: 401,
      };
    }

    if (instance.expiresAt < Date.now()) {
      return {
        authorized: false as const,
        error: "Instance token has expired",
        statusCode: 401,
      };
    }

    if (instance.appName !== args.appName) {
      return {
        authorized: false as const,
        error: "Token does not match this app",
        statusCode: 403,
      };
    }

    const agentId = instance.agentId;

    // 2. Check agent is active
    const agent = await ctx.db
      .query("registeredAgents")
      .withIndex("by_agent_id", (q) => q.eq("agentId", agentId))
      .unique();

    if (!agent || !agent.isActive) {
      return {
        authorized: false as const,
        error: "Agent has been revoked",
        statusCode: 403,
        agentId,
      };
    }

    // 3. Check permissions
    const permissions = await ctx.db
      .query("functionPermissions")
      .withIndex("by_agent_and_app", (q) =>
        q.eq("agentId", agentId).eq("appName", args.appName),
      )
      .collect();

    const matches = permissions
      .filter((p) => matchesPattern(args.functionName, p.functionPattern))
      .sort(
        (a, b) =>
          patternSpecificity(b.functionPattern) -
          patternSpecificity(a.functionPattern),
      );

    if (matches.length === 0 || matches[0].permission === "deny") {
      const bestMatch = matches[0];
      return {
        authorized: false as const,
        error: "Function not authorized for this agent",
        statusCode: 403,
        agentId,
        matchedPattern: bestMatch?.functionPattern,
        matchedPermission: bestMatch?.permission,
      };
    }

    // TODO: For rate_limited permissions, check rate counters here
    // (circuit breaker - deferred to post-MVP)

    // 4. Look up function handle
    const fnEntry = await ctx.db
      .query("functionRegistry")
      .withIndex("by_app_and_function", (q) =>
        q.eq("appName", args.appName).eq("functionName", args.functionName),
      )
      .unique();

    if (!fnEntry) {
      return {
        authorized: false as const,
        error: `Function "${args.functionName}" is not registered`,
        statusCode: 404,
        agentId,
      };
    }

    // 5. Update activity counters
    await ctx.db.patch(instance._id, {
      lastActivityAt: Date.now(),
      monthlyRequests: instance.monthlyRequests + 1,
    });

    return {
      authorized: true as const,
      agentId,
      appName: args.appName,
      functionHandle: fnEntry.functionHandle,
      functionType: fnEntry.functionType,
    };
  },
});

/**
 * Log an access attempt to the audit log.
 * Called after function execution (success or failure).
 */
export const logAccess = mutation({
  args: {
    agentId: v.string(),
    appName: v.string(),
    functionCalled: v.string(),
    permission: v.string(),
    errorMessage: v.optional(v.string()),
    durationMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("accessLog", {
      timestamp: Date.now(),
      agentId: args.agentId,
      appName: args.appName,
      functionCalled: args.functionCalled,
      permission: args.permission,
      errorMessage: args.errorMessage,
      durationMs: args.durationMs,
    });
    return null;
  },
});

/**
 * Query access logs for audit purposes.
 */
export const queryAccessLog = query({
  args: {
    agentId: v.optional(v.string()),
    appName: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      timestamp: v.number(),
      agentId: v.string(),
      appName: v.string(),
      functionCalled: v.string(),
      permission: v.string(),
      errorMessage: v.optional(v.string()),
      durationMs: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    if (args.agentId) {
      const logs = await ctx.db
        .query("accessLog")
        .withIndex("by_agent_and_timestamp", (q) =>
          q.eq("agentId", args.agentId!),
        )
        .order("desc")
        .take(limit);

      return logs.map((l) => ({
        timestamp: l.timestamp,
        agentId: l.agentId,
        appName: l.appName,
        functionCalled: l.functionCalled,
        permission: l.permission,
        errorMessage: l.errorMessage,
        durationMs: l.durationMs,
      }));
    }

    // No filter: get recent logs
    const logs = await ctx.db
      .query("accessLog")
      .order("desc")
      .take(limit);

    return logs.map((l) => ({
      timestamp: l.timestamp,
      agentId: l.agentId,
      appName: l.appName,
      functionCalled: l.functionCalled,
      permission: l.permission,
      errorMessage: l.errorMessage,
      durationMs: l.durationMs,
    }));
  },
});
