import { v } from "convex/values";
import { mutation, query, internalQuery } from "./_generated/server.js";

// --- Permission result type ---

const permissionResultValidator = v.object({
  permission: v.union(
    v.literal("allow"),
    v.literal("deny"),
    v.literal("rate_limited"),
  ),
  rateLimitConfig: v.optional(
    v.object({
      requestsPerHour: v.number(),
      tokenBudget: v.number(),
    }),
  ),
  matchedPattern: v.optional(v.string()),
});

// --- Pattern matching utilities ---

/**
 * Calculate specificity score for a pattern.
 * More specific patterns (fewer wildcards, longer) get higher scores.
 */
function patternSpecificity(pattern: string): number {
  if (pattern === "*") return 0;
  const wildcardCount = (pattern.match(/\*/g) || []).length;
  // Longer patterns with fewer wildcards are more specific
  return pattern.length * 10 - wildcardCount * 100;
}

/**
 * Check if a function name matches a permission pattern.
 * Supports "*" as a wildcard that matches any characters.
 * Examples: "okr:*" matches "okr:getObjectives", "*" matches anything.
 */
function matchesPattern(functionName: string, pattern: string): boolean {
  if (pattern === "*") return true;
  // Escape regex special chars except *, then replace * with .*
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const regexStr = "^" + escaped.replace(/\*/g, ".*") + "$";
  const regex = new RegExp(regexStr);
  return regex.test(functionName);
}

// --- Public functions ---

/**
 * Set a permission for an agent on a specific app.
 * If a permission with the same agentId + appName + functionPattern exists, it is updated.
 */
export const setPermission = mutation({
  args: {
    agentId: v.string(),
    appName: v.string(),
    functionPattern: v.string(),
    permission: v.union(
      v.literal("allow"),
      v.literal("deny"),
      v.literal("rate_limited"),
    ),
    rateLimitConfig: v.optional(
      v.object({
        requestsPerHour: v.number(),
        tokenBudget: v.number(),
      }),
    ),
    createdBy: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    // Check for existing permission with same pattern
    const existing = await ctx.db
      .query("functionPermissions")
      .withIndex("by_agent_and_app", (q) =>
        q.eq("agentId", args.agentId).eq("appName", args.appName),
      )
      .collect();

    const match = existing.find(
      (p) => p.functionPattern === args.functionPattern,
    );

    if (match) {
      await ctx.db.patch(match._id, {
        permission: args.permission,
        rateLimitConfig: args.rateLimitConfig,
        createdBy: args.createdBy,
        createdAt: Date.now(),
      });
      return match._id;
    }

    const id = await ctx.db.insert("functionPermissions", {
      agentId: args.agentId,
      appName: args.appName,
      functionPattern: args.functionPattern,
      permission: args.permission,
      rateLimitConfig: args.rateLimitConfig,
      createdAt: Date.now(),
      createdBy: args.createdBy,
    });
    return id;
  },
});

/**
 * Remove a specific permission.
 */
export const removePermission = mutation({
  args: {
    agentId: v.string(),
    appName: v.string(),
    functionPattern: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const perms = await ctx.db
      .query("functionPermissions")
      .withIndex("by_agent_and_app", (q) =>
        q.eq("agentId", args.agentId).eq("appName", args.appName),
      )
      .collect();

    const match = perms.find(
      (p) => p.functionPattern === args.functionPattern,
    );

    if (!match) return false;

    await ctx.db.delete(match._id);
    return true;
  },
});

/**
 * Check permission for a specific function call.
 * Applies pattern matching with specificity ordering (most specific pattern wins).
 * Default: deny if no matching pattern is found.
 */
export const checkPermission = query({
  args: {
    agentId: v.string(),
    appName: v.string(),
    functionName: v.string(),
  },
  returns: permissionResultValidator,
  handler: async (ctx, args) => {
    const permissions = await ctx.db
      .query("functionPermissions")
      .withIndex("by_agent_and_app", (q) =>
        q.eq("agentId", args.agentId).eq("appName", args.appName),
      )
      .collect();

    // Find all matching patterns and sort by specificity (most specific first)
    const matches = permissions
      .filter((p) => matchesPattern(args.functionName, p.functionPattern))
      .sort(
        (a, b) =>
          patternSpecificity(b.functionPattern) -
          patternSpecificity(a.functionPattern),
      );

    if (matches.length === 0) {
      // Default: deny
      return { permission: "deny" as const };
    }

    // Most specific pattern wins
    const best = matches[0];
    return {
      permission: best.permission,
      rateLimitConfig: best.rateLimitConfig,
      matchedPattern: best.functionPattern,
    };
  },
});

/**
 * List all permissions for an agent on a specific app.
 */
export const listPermissions = query({
  args: {
    agentId: v.string(),
    appName: v.string(),
  },
  returns: v.array(
    v.object({
      functionPattern: v.string(),
      permission: v.union(
        v.literal("allow"),
        v.literal("deny"),
        v.literal("rate_limited"),
      ),
      rateLimitConfig: v.optional(
        v.object({
          requestsPerHour: v.number(),
          tokenBudget: v.number(),
        }),
      ),
      createdAt: v.number(),
      createdBy: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const perms = await ctx.db
      .query("functionPermissions")
      .withIndex("by_agent_and_app", (q) =>
        q.eq("agentId", args.agentId).eq("appName", args.appName),
      )
      .collect();

    return perms.map((p) => ({
      functionPattern: p.functionPattern,
      permission: p.permission,
      rateLimitConfig: p.rateLimitConfig,
      createdAt: p.createdAt,
      createdBy: p.createdBy,
    }));
  },
});

/**
 * Remove all permissions for a specific agent on a specific app.
 */
export const clearPermissions = mutation({
  args: {
    agentId: v.string(),
    appName: v.string(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const perms = await ctx.db
      .query("functionPermissions")
      .withIndex("by_agent_and_app", (q) =>
        q.eq("agentId", args.agentId).eq("appName", args.appName),
      )
      .collect();

    for (const perm of perms) {
      await ctx.db.delete(perm._id);
    }

    return perms.length;
  },
});
