import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import { hashApiKey, normalizeAppKey } from "./agentBridgeUtils.js";

export const createAgent = mutation({
  args: {
    name: v.string(),
    appKey: v.optional(v.string()),
    apiKey: v.string(),
    enabled: v.optional(v.boolean()),
    rateLimit: v.optional(v.number()),
  },
  returns: v.object({
    agentId: v.id("agents"),
  }),
  handler: async (ctx, args) => {
    const normalizedAppKey = args.appKey
      ? normalizeAppKey(args.appKey)
      : undefined;
    if (normalizedAppKey) {
      const existingByAppKey = await ctx.db
        .query("agents")
        .withIndex("by_appKey", (q) => q.eq("appKey", normalizedAppKey))
        .unique();
      if (existingByAppKey) {
        throw new Error("An agent with this app key already exists");
      }
    }

    const apiKeyHash = await hashApiKey(args.apiKey);
    const existing = await ctx.db
      .query("agents")
      .withIndex("by_apiKeyHash", (q) => q.eq("apiKeyHash", apiKeyHash))
      .unique();

    if (existing) {
      throw new Error("An agent with this API key already exists");
    }

    const agentId = await ctx.db.insert("agents", {
      name: args.name,
      appKey: normalizedAppKey,
      apiKeyHash,
      enabled: args.enabled ?? true,
      rateLimit: args.rateLimit ?? 1000,
      createdAt: Date.now(),
    });

    return { agentId };
  },
});

export const rotateApiKey = mutation({
  args: {
    agentId: v.id("agents"),
    newApiKey: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) {
      throw new Error("Agent not found");
    }

    const newApiKeyHash = await hashApiKey(args.newApiKey);
    await ctx.db.patch(args.agentId, {
      apiKeyHash: newApiKeyHash,
    });

    return null;
  },
});

export const updateAgent = mutation({
  args: {
    agentId: v.id("agents"),
    name: v.optional(v.string()),
    appKey: v.optional(v.string()),
    enabled: v.optional(v.boolean()),
    rateLimit: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) {
      throw new Error("Agent not found");
    }

    const normalizedAppKey = args.appKey
      ? normalizeAppKey(args.appKey)
      : undefined;
    if (normalizedAppKey) {
      const existingByAppKey = await ctx.db
        .query("agents")
        .withIndex("by_appKey", (q) => q.eq("appKey", normalizedAppKey))
        .unique();
      if (existingByAppKey && existingByAppKey._id !== args.agentId) {
        throw new Error("An agent with this app key already exists");
      }
    }

    await ctx.db.patch(args.agentId, {
      name: args.name ?? agent.name,
      appKey: normalizedAppKey ?? agent.appKey,
      enabled: args.enabled ?? agent.enabled,
      rateLimit: args.rateLimit ?? agent.rateLimit,
    });

    return null;
  },
});

export const listAgents = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("agents"),
      name: v.string(),
      appKey: v.optional(v.string()),
      enabled: v.boolean(),
      rateLimit: v.number(),
      lastUsed: v.optional(v.number()),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const agents = await ctx.db.query("agents").collect();
    return agents.map((agent) => ({
      _id: agent._id,
      name: agent.name,
      appKey: agent.appKey,
      enabled: agent.enabled,
      rateLimit: agent.rateLimit,
      lastUsed: agent.lastUsed,
      createdAt: agent.createdAt,
    }));
  },
});
