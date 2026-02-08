import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";

/**
 * Register a function handle that agents can call.
 * The host app creates a function handle via createFunctionHandle()
 * and registers it here with a human-readable alias.
 *
 * If a function with the same appName + functionName already exists, it is updated.
 */
export const register = mutation({
  args: {
    appName: v.string(),
    functionName: v.string(),
    functionHandle: v.string(),
    functionType: v.union(
      v.literal("query"),
      v.literal("mutation"),
      v.literal("action"),
    ),
    description: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    // Check if already registered (upsert)
    const existing = await ctx.db
      .query("functionRegistry")
      .withIndex("by_app_and_function", (q) =>
        q.eq("appName", args.appName).eq("functionName", args.functionName),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        functionHandle: args.functionHandle,
        functionType: args.functionType,
        description: args.description,
        registeredAt: Date.now(),
      });
      return existing._id;
    }

    const id = await ctx.db.insert("functionRegistry", {
      appName: args.appName,
      functionName: args.functionName,
      functionHandle: args.functionHandle,
      functionType: args.functionType,
      description: args.description,
      registeredAt: Date.now(),
    });
    return id;
  },
});

/**
 * Get a specific function handle by appName + functionName.
 * Returns null if not found.
 */
export const getHandle = query({
  args: {
    appName: v.string(),
    functionName: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      functionHandle: v.string(),
      functionType: v.union(
        v.literal("query"),
        v.literal("mutation"),
        v.literal("action"),
      ),
      functionName: v.string(),
      description: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const entry = await ctx.db
      .query("functionRegistry")
      .withIndex("by_app_and_function", (q) =>
        q.eq("appName", args.appName).eq("functionName", args.functionName),
      )
      .unique();

    if (!entry) return null;

    return {
      functionHandle: entry.functionHandle,
      functionType: entry.functionType,
      functionName: entry.functionName,
      description: entry.description,
    };
  },
});

/**
 * List all registered functions for a given app.
 */
export const listFunctions = query({
  args: {
    appName: v.string(),
  },
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
  handler: async (ctx, args) => {
    const entries = await ctx.db
      .query("functionRegistry")
      .withIndex("by_app_and_function", (q) => q.eq("appName", args.appName))
      .collect();

    return entries.map((entry) => ({
      functionName: entry.functionName,
      functionType: entry.functionType,
      description: entry.description,
      registeredAt: entry.registeredAt,
    }));
  },
});

/**
 * Unregister a function handle.
 */
export const unregister = mutation({
  args: {
    appName: v.string(),
    functionName: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("functionRegistry")
      .withIndex("by_app_and_function", (q) =>
        q.eq("appName", args.appName).eq("functionName", args.functionName),
      )
      .unique();

    if (!existing) return false;

    await ctx.db.delete(existing._id);
    return true;
  },
});
