import { mutation, query, internalMutation } from "./_generated/server.js";
import { components } from "./_generated/api.js";
import { internal, api } from "./_generated/api.js";
import { AgentBridge } from "@okrlinkhub/agent-bridge";
import { v } from "convex/values";
import { createFunctionHandle } from "convex/server";

// --- Initialize the AgentBridge client ---

const bridge = new AgentBridge(components.agentBridge, {
  appName: "demo",
  defaultPermissions: [
    { pattern: "demo:list*", permission: "allow" },
    { pattern: "demo:get*", permission: "allow" },
    { pattern: "demo:create*", permission: "rate_limited", rateLimitConfig: { requestsPerHour: 50, tokenBudget: 50000 } },
    { pattern: "*", permission: "deny" },
  ],
});

// --- Setup: Configure component and register functions ---

/**
 * One-time setup: configures the component and registers functions
 * that agents are allowed to call.
 * Run this once after deploying: `npx convex run example:setup`
 */
export const setup = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    // 1. Configure the component with app name and default permissions
    await bridge.configure(ctx);

    // 2. Register functions that agents can call
    const listHandle = await createFunctionHandle(api.example.listItems);
    const getHandle = await createFunctionHandle(api.example.getItem);
    const createHandle = await createFunctionHandle(api.example.createItem);

    await bridge.registerFunctions(ctx, [
      {
        name: "demo:listItems",
        handle: listHandle,
        type: "query",
        description: "List all active items",
      },
      {
        name: "demo:getItem",
        handle: getHandle,
        type: "query",
        description: "Get a specific item by ID",
      },
      {
        name: "demo:createItem",
        handle: createHandle,
        type: "mutation",
        description: "Create a new item",
      },
    ]);

    return null;
  },
});

// --- Admin operations ---

/**
 * Generate a provisioning token for an employee.
 * Admin-only operation.
 */
export const generateToken = mutation({
  args: {
    employeeEmail: v.string(),
    department: v.string(),
    maxApps: v.optional(v.number()),
  },
  returns: v.object({
    token: v.string(),
    expiresAt: v.number(),
  }),
  handler: async (ctx, args) => {
    // In production, authenticate the admin here via ctx.auth
    return await bridge.generateProvisioningToken(ctx, {
      employeeEmail: args.employeeEmail,
      department: args.department,
      maxApps: args.maxApps,
      createdBy: "admin@example.com",
    });
  },
});

/**
 * List all registered agents.
 */
export const agents = query({
  args: {},
  returns: v.array(
    v.object({
      agentId: v.string(),
      employeeEmail: v.string(),
      department: v.string(),
      firstRegisteredAt: v.number(),
      lastSeenAt: v.number(),
      isActive: v.boolean(),
      revokedAt: v.optional(v.number()),
      revokedBy: v.optional(v.string()),
    }),
  ),
  handler: async (ctx) => {
    return await bridge.listAgents(ctx);
  },
});

/**
 * List all registered functions available to agents.
 */
export const registeredFunctions = query({
  args: {},
  returns: v.array(
    v.object({
      functionName: v.string(),
      functionType: v.union(
        v.literal("query"),
        v.literal("mutation"),
        v.literal("action"),
      ),
      description: v.optional(v.string()),
      registeredAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    return await bridge.listFunctions(ctx);
  },
});

/**
 * View access logs.
 */
export const accessLogs = query({
  args: {
    agentId: v.optional(v.string()),
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
    return await bridge.queryAccessLog(ctx, {
      agentId: args.agentId,
      limit: args.limit,
    });
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
