import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import { patternMatchesAvailableFunctions } from "./agentBridgeUtils.js";

const permissionRuleValidator = v.object({
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
});

export const setAgentPermissions = mutation({
  args: {
    agentId: v.id("agents"),
    rules: v.array(permissionRuleValidator),
    availableFunctionKeys: v.array(v.string()),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    for (const rule of args.rules) {
      const isValid = patternMatchesAvailableFunctions(
        rule.pattern,
        args.availableFunctionKeys,
      );
      if (!isValid) {
        throw new Error(
          `Pattern "${rule.pattern}" does not match any configured function`,
        );
      }
    }

    const existingRules = await ctx.db
      .query("agentPermissions")
      .withIndex("by_agentId", (q) => q.eq("agentId", args.agentId))
      .collect();

    for (const existingRule of existingRules) {
      await ctx.db.delete(existingRule._id);
    }

    for (const rule of args.rules) {
      await ctx.db.insert("agentPermissions", {
        agentId: args.agentId,
        functionPattern: rule.pattern,
        permission: rule.permission,
        rateLimitConfig: rule.rateLimitConfig,
        updatedAt: Date.now(),
      });
    }

    return args.rules.length;
  },
});

export const listAgentPermissions = query({
  args: {
    agentId: v.id("agents"),
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
          tokenBudget: v.optional(v.number()),
        }),
      ),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const rules = await ctx.db
      .query("agentPermissions")
      .withIndex("by_agentId", (q) => q.eq("agentId", args.agentId))
      .collect();

    return rules.map((rule) => ({
      functionPattern: rule.functionPattern,
      permission: rule.permission,
      rateLimitConfig: rule.rateLimitConfig,
      updatedAt: rule.updatedAt,
    }));
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
    availableFunctionKeys: v.array(v.string()),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    for (const override of args.overrides) {
      if (!args.availableFunctionKeys.includes(override.key)) {
        throw new Error(`Function "${override.key}" is not exposed in config`);
      }

      const existing = await ctx.db
        .query("agentFunctions")
        .withIndex("by_key", (q) => q.eq("key", override.key))
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, {
          enabled: override.enabled,
          globalRateLimit: override.globalRateLimit,
        });
      } else {
        await ctx.db.insert("agentFunctions", {
          key: override.key,
          enabled: override.enabled,
          globalRateLimit: override.globalRateLimit,
        });
      }
    }

    return args.overrides.length;
  },
});

export const listFunctionOverrides = query({
  args: {},
  returns: v.array(
    v.object({
      key: v.string(),
      enabled: v.boolean(),
      globalRateLimit: v.optional(v.number()),
    }),
  ),
  handler: async (ctx) => {
    const rows = await ctx.db.query("agentFunctions").collect();
    return rows.map((row) => ({
      key: row.key,
      enabled: row.enabled,
      globalRateLimit: row.globalRateLimit,
    }));
  },
});
