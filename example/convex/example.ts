import { mutation, query } from "./_generated/server.js";
import { components } from "./_generated/api.js";
import { v } from "convex/values";

const EXPOSED_FUNCTION_KEYS = [
  "demo.listItems",
  "demo.getItem",
  "demo.createItem",
] as const;

const EXPOSED_FUNCTIONS = [
  {
    functionKey: "demo.listItems",
    type: "query" as const,
    description: "Lista tutti gli item attivi",
    riskLevel: "low" as const,
    category: "demo",
  },
  {
    functionKey: "demo.getItem",
    type: "query" as const,
    description: "Restituisce un item per ID",
    riskLevel: "low" as const,
    category: "demo",
  },
  {
    functionKey: "demo.createItem",
    type: "mutation" as const,
    description: "Crea un nuovo item",
    riskLevel: "medium" as const,
    category: "demo",
  },
] as const;

export const createAgent = mutation({
  args: {
    name: v.string(),
    appKey: v.optional(v.string()),
    apiKey: v.string(),
    rateLimit: v.optional(v.number()),
  },
  returns: v.object({
    agentId: v.string(),
  }),
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.agentBridge.agents.createAgent, {
      name: args.name,
      appKey: args.appKey,
      apiKey: args.apiKey,
      rateLimit: args.rateLimit,
    });
  },
});

export const setAgentPermissions = mutation({
  args: {
    agentId: v.string(),
    rules: v.array(
      v.object({
        pattern: v.string(),
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
      }),
    ),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    return await ctx.runMutation(
      components.agentBridge.permissions.setAgentPermissions,
      {
        agentId: args.agentId as never,
        rules: args.rules,
        availableFunctionKeys: [...EXPOSED_FUNCTION_KEYS],
      },
    );
  },
});

export const setFunctionOverrides = mutation({
  args: {
    overrides: v.array(
      v.object({
        key: v.string(),
        enabled: v.boolean(),
        globalRateLimit: v.optional(v.number()),
      }),
    ),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    return await ctx.runMutation(
      components.agentBridge.permissions.setFunctionOverrides,
      {
        overrides: args.overrides,
        availableFunctionKeys: [...EXPOSED_FUNCTION_KEYS],
      },
    );
  },
});

export const configuredFunctions = query({
  args: {},
  returns: v.array(
    v.object({
      functionKey: v.string(),
      type: v.union(
        v.literal("query"),
        v.literal("mutation"),
        v.literal("action"),
      ),
      description: v.optional(v.string()),
      riskLevel: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"))),
      category: v.optional(v.string()),
    }),
  ),
  handler: async () => {
    return [...EXPOSED_FUNCTIONS];
  },
});

export const agents = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.string(),
      name: v.string(),
      appKey: v.optional(v.string()),
      enabled: v.boolean(),
      rateLimit: v.number(),
      lastUsed: v.optional(v.number()),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const rows = await ctx.runQuery(components.agentBridge.agents.listAgents, {});
    return rows.map((row) => ({
      _id: row._id,
      name: row.name,
      appKey: row.appKey,
      enabled: row.enabled,
      rateLimit: row.rateLimit,
      lastUsed: row.lastUsed,
      createdAt: row.createdAt,
    }));
  },
});

export const accessLogs = query({
  args: {
    agentId: v.optional(v.string()),
    serviceId: v.optional(v.string()),
    functionKey: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.string(),
      timestamp: v.number(),
      agentId: v.string(),
      serviceId: v.optional(v.string()),
      functionKey: v.string(),
      args: v.any(),
      result: v.optional(v.any()),
      error: v.optional(v.string()),
      duration: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const logs = await ctx.runQuery(components.agentBridge.gateway.queryAccessLog, {
      agentId: args.agentId as never,
      serviceId: args.serviceId,
      functionKey: args.functionKey,
      limit: args.limit,
    });
    return logs.map((log) => ({
      _id: log._id,
      timestamp: log.timestamp,
      agentId: log.agentId,
      serviceId: log.serviceId,
      functionKey: log.functionKey,
      args: log.args,
      result: log.result,
      error: log.error,
      duration: log.duration,
    }));
  },
});

// --- Example app functions (these are what agents call via the gateway) ---

/**
 * List all active items.
 */
export const listItems = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("items"),
      _creationTime: v.number(),
      name: v.string(),
      description: v.string(),
      status: v.union(v.literal("active"), v.literal("archived")),
      createdBy: v.string(),
    }),
  ),
  handler: async (ctx) => {
    return await ctx.db
      .query("items")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
  },
});

/**
 * Get a specific item by ID.
 */
export const getItem = query({
  args: { itemId: v.id("items") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("items"),
      _creationTime: v.number(),
      name: v.string(),
      description: v.string(),
      status: v.union(v.literal("active"), v.literal("archived")),
      createdBy: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.itemId);
  },
});

/**
 * Create a new item.
 */
export const createItem = mutation({
  args: {
    name: v.string(),
    description: v.string(),
  },
  returns: v.id("items"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("items", {
      name: args.name,
      description: args.description,
      status: "active",
      createdBy: "agent",
    });
  },
});
