import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";

// --- Helpers ---

/**
 * Get the current hour window string (e.g. "2026-02-08T14").
 */
function getCurrentWindowHour(): string {
  return new Date().toISOString().slice(0, 13);
}

/**
 * Calculate seconds remaining until the current hour window expires.
 */
export function secondsUntilWindowExpires(): number {
  const now = new Date();
  const nextHour = new Date(now);
  nextHour.setMinutes(0, 0, 0);
  nextHour.setHours(nextHour.getHours() + 1);
  return Math.ceil((nextHour.getTime() - now.getTime()) / 1000);
}

// --- Validators ---

const checkResultValidator = v.object({
  allowed: v.boolean(),
  reason: v.optional(v.string()),
  currentCount: v.number(),
  currentTokens: v.number(),
});

const statusValidator = v.object({
  agentId: v.string(),
  appName: v.string(),
  windowHour: v.string(),
  requestCount: v.number(),
  tokenEstimate: v.number(),
  isBlocked: v.boolean(),
  blockedReason: v.optional(v.string()),
  blockedAt: v.optional(v.number()),
});

// --- Public functions ---

/**
 * Check the circuit breaker and increment counters if allowed.
 * This is designed to be called from within the gateway's authorizeRequest
 * mutation, but is also exposed for direct use.
 *
 * Looks up or creates the counter for the current hour window, checks
 * if the agent is already blocked, then increments request count and
 * token estimate. If limits are exceeded, blocks the agent for the
 * remainder of the hour window.
 */
export const checkAndIncrement = mutation({
  args: {
    agentId: v.string(),
    appName: v.string(),
    estimatedCost: v.number(),
    limits: v.object({
      requestsPerHour: v.number(),
      tokenBudget: v.number(),
    }),
  },
  returns: checkResultValidator,
  handler: async (ctx, args) => {
    const windowHour = getCurrentWindowHour();

    // Find or create counter for this window
    let counter = await ctx.db
      .query("circuitCounters")
      .withIndex("by_agentId_and_appName_and_windowHour", (q) =>
        q
          .eq("agentId", args.agentId)
          .eq("appName", args.appName)
          .eq("windowHour", windowHour),
      )
      .unique();

    if (!counter) {
      // Create new counter for this window
      const id = await ctx.db.insert("circuitCounters", {
        agentId: args.agentId,
        appName: args.appName,
        windowHour,
        requestCount: 0,
        tokenEstimate: 0,
        isBlocked: false,
      });
      counter = (await ctx.db.get(id))!;
    }

    // If already blocked, deny immediately
    if (counter.isBlocked) {
      return {
        allowed: false,
        reason: counter.blockedReason ?? "Circuit breaker is open",
        currentCount: counter.requestCount,
        currentTokens: counter.tokenEstimate,
      };
    }

    // Check if this request would exceed limits
    const newRequestCount = counter.requestCount + 1;
    const newTokenEstimate = counter.tokenEstimate + args.estimatedCost;

    const requestsExceeded = newRequestCount > args.limits.requestsPerHour;
    const tokensExceeded = newTokenEstimate > args.limits.tokenBudget;

    if (requestsExceeded || tokensExceeded) {
      // Block the circuit breaker
      const reason = requestsExceeded
        ? `Requests per hour exceeded (${newRequestCount}/${args.limits.requestsPerHour})`
        : `Token budget exceeded (${newTokenEstimate}/${args.limits.tokenBudget})`;

      await ctx.db.patch(counter._id, {
        requestCount: newRequestCount,
        tokenEstimate: newTokenEstimate,
        isBlocked: true,
        blockedReason: reason,
        blockedAt: Date.now(),
      });

      return {
        allowed: false,
        reason,
        currentCount: newRequestCount,
        currentTokens: newTokenEstimate,
      };
    }

    // Increment counters
    await ctx.db.patch(counter._id, {
      requestCount: newRequestCount,
      tokenEstimate: newTokenEstimate,
    });

    return {
      allowed: true,
      currentCount: newRequestCount,
      currentTokens: newTokenEstimate,
    };
  },
});

/**
 * Get the current circuit breaker status for an agent on an app.
 * Returns the counter for the current hour window.
 */
export const getStatus = query({
  args: {
    agentId: v.string(),
    appName: v.string(),
  },
  returns: v.union(statusValidator, v.null()),
  handler: async (ctx, args) => {
    const windowHour = getCurrentWindowHour();

    const counter = await ctx.db
      .query("circuitCounters")
      .withIndex("by_agentId_and_appName_and_windowHour", (q) =>
        q
          .eq("agentId", args.agentId)
          .eq("appName", args.appName)
          .eq("windowHour", windowHour),
      )
      .unique();

    if (!counter) {
      return null;
    }

    return {
      agentId: counter.agentId,
      appName: counter.appName,
      windowHour: counter.windowHour,
      requestCount: counter.requestCount,
      tokenEstimate: counter.tokenEstimate,
      isBlocked: counter.isBlocked,
      blockedReason: counter.blockedReason,
      blockedAt: counter.blockedAt,
    };
  },
});

/**
 * Admin function to manually reset a blocked circuit breaker.
 * Creates a fresh counter for the current window with zeroed values.
 */
export const resetCounter = mutation({
  args: {
    agentId: v.string(),
    appName: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const windowHour = getCurrentWindowHour();

    const counter = await ctx.db
      .query("circuitCounters")
      .withIndex("by_agentId_and_appName_and_windowHour", (q) =>
        q
          .eq("agentId", args.agentId)
          .eq("appName", args.appName)
          .eq("windowHour", windowHour),
      )
      .unique();

    if (!counter) {
      return false;
    }

    await ctx.db.patch(counter._id, {
      requestCount: 0,
      tokenEstimate: 0,
      isBlocked: false,
      blockedReason: undefined,
      blockedAt: undefined,
    });

    return true;
  },
});

/**
 * List all currently blocked circuit breakers.
 * Useful for admin dashboards.
 */
export const listBlocked = query({
  args: {},
  returns: v.array(statusValidator),
  handler: async (ctx) => {
    const blocked = await ctx.db
      .query("circuitCounters")
      .withIndex("by_isBlocked", (q) => q.eq("isBlocked", true))
      .collect();

    return blocked.map((c) => ({
      agentId: c.agentId,
      appName: c.appName,
      windowHour: c.windowHour,
      requestCount: c.requestCount,
      tokenEstimate: c.tokenEstimate,
      isBlocked: c.isBlocked,
      blockedReason: c.blockedReason,
      blockedAt: c.blockedAt,
    }));
  },
});
