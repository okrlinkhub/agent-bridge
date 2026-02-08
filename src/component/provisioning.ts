import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server.js";

// --- Token hashing utility (SHA-256, no external deps) ---

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// --- Public mutations ---

/**
 * Generate a provisioning token (APT) for an employee.
 * Called by IT admin. Returns the plaintext token (store it securely!).
 */
export const generateProvisioningToken = mutation({
  args: {
    employeeEmail: v.string(),
    department: v.string(),
    maxApps: v.optional(v.number()),
    expiresInDays: v.optional(v.number()),
    createdBy: v.string(),
  },
  returns: v.object({
    token: v.string(),
    expiresAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const token = "apt_live_" + crypto.randomUUID().replace(/-/g, "");
    const tokenHash = await hashToken(token);
    const expiresAt =
      Date.now() + (args.expiresInDays ?? 7) * 24 * 60 * 60 * 1000;

    await ctx.db.insert("provisioningTokens", {
      tokenHash,
      employeeEmail: args.employeeEmail,
      department: args.department,
      maxApps: args.maxApps ?? 5,
      usedCount: 0,
      expiresAt,
      isActive: true,
      createdBy: args.createdBy,
    });

    return { token, expiresAt };
  },
});

/**
 * Provision an agent on a specific app.
 * Called by the employee (or their OpenClaw agent on bootstrap).
 * Validates the APT, creates/finds the agent, creates an app instance.
 */
export const provisionAgent = mutation({
  args: {
    provisioningToken: v.string(),
    appName: v.string(),
  },
  returns: v.object({
    agentId: v.string(),
    instanceToken: v.string(),
    expiresAt: v.number(),
    appName: v.string(),
    message: v.string(),
  }),
  handler: async (ctx, args) => {
    const tokenHash = await hashToken(args.provisioningToken);

    // Find and validate the provisioning token
    const tokenRecord = await ctx.db
      .query("provisioningTokens")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
      .unique();

    if (!tokenRecord || !tokenRecord.isActive) {
      throw new Error("Invalid provisioning token");
    }
    if (tokenRecord.expiresAt < Date.now()) {
      throw new Error("Provisioning token has expired");
    }
    if (tokenRecord.usedCount >= tokenRecord.maxApps) {
      throw new Error("Maximum number of apps reached for this token");
    }

    // Find or create the agent
    let agent = await ctx.db
      .query("registeredAgents")
      .withIndex("by_email", (q) =>
        q.eq("employeeEmail", tokenRecord.employeeEmail),
      )
      .unique();

    let agentId: string;

    if (!agent) {
      // First provisioning: create global agent record
      agentId = crypto.randomUUID();
      await ctx.db.insert("registeredAgents", {
        agentId,
        employeeEmail: tokenRecord.employeeEmail,
        department: tokenRecord.department,
        firstRegisteredAt: Date.now(),
        lastSeenAt: Date.now(),
        isActive: true,
      });
    } else {
      if (!agent.isActive) {
        throw new Error("Agent has been revoked");
      }
      agentId = agent.agentId;
      // Update last seen
      await ctx.db.patch(agent._id, { lastSeenAt: Date.now() });
    }

    // Check if instance already exists for this app
    const existing = await ctx.db
      .query("agentAppInstances")
      .withIndex("by_agent_and_app", (q) =>
        q.eq("agentId", agentId).eq("appName", args.appName),
      )
      .unique();

    if (existing && existing.expiresAt > Date.now()) {
      // Return existing valid instance (but we can't return the token since we only store the hash)
      // Generate a new token and update the hash
      const instanceToken = crypto.randomUUID();
      const instanceTokenHash = await hashToken(instanceToken);
      const expiresAt = Date.now() + 24 * 60 * 60 * 1000;

      await ctx.db.patch(existing._id, {
        instanceTokenHash,
        expiresAt,
        lastActivityAt: Date.now(),
      });

      return {
        agentId,
        instanceToken,
        expiresAt,
        appName: args.appName,
        message: "Instance refreshed with new credentials",
      };
    }

    if (existing) {
      // Expired instance: delete and recreate
      await ctx.db.delete(existing._id);
    }

    // Create new instance
    const instanceToken = crypto.randomUUID();
    const instanceTokenHash = await hashToken(instanceToken);
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24h

    await ctx.db.insert("agentAppInstances", {
      agentId,
      appName: args.appName,
      instanceTokenHash,
      registeredAt: Date.now(),
      expiresAt,
      lastActivityAt: Date.now(),
      monthlyRequests: 0,
    });

    // Increment token usage
    await ctx.db.patch(tokenRecord._id, {
      usedCount: tokenRecord.usedCount + 1,
    });

    // Setup default permissions from component config
    const config = await ctx.db.query("componentConfig").first();
    if (config && config.defaultPermissions.length > 0) {
      for (const perm of config.defaultPermissions) {
        await ctx.db.insert("functionPermissions", {
          agentId,
          appName: args.appName,
          functionPattern: perm.pattern,
          permission: perm.permission,
          rateLimitConfig: perm.rateLimitConfig,
          createdAt: Date.now(),
          createdBy: "system",
        });
      }
    }

    return {
      agentId,
      instanceToken,
      expiresAt,
      appName: args.appName,
      message:
        "Provisioning successful. Configure your agent with these credentials.",
    };
  },
});

/**
 * Refresh an expired instance token.
 * Called by the agent when its token expires.
 */
export const refreshInstanceToken = mutation({
  args: {
    agentId: v.string(),
    appName: v.string(),
    currentTokenHash: v.string(), // Hash of the current (expired) token for verification
  },
  returns: v.object({
    instanceToken: v.string(),
    expiresAt: v.number(),
  }),
  handler: async (ctx, args) => {
    // Verify the agent exists and is active
    const agent = await ctx.db
      .query("registeredAgents")
      .withIndex("by_agent_id", (q) => q.eq("agentId", args.agentId))
      .unique();

    if (!agent || !agent.isActive) {
      throw new Error("Agent not found or has been revoked");
    }

    // Find the instance
    const instance = await ctx.db
      .query("agentAppInstances")
      .withIndex("by_agent_and_app", (q) =>
        q.eq("agentId", args.agentId).eq("appName", args.appName),
      )
      .unique();

    if (!instance) {
      throw new Error("No instance found for this agent and app");
    }

    // Verify the current token hash matches
    if (instance.instanceTokenHash !== args.currentTokenHash) {
      throw new Error("Token hash mismatch");
    }

    // Generate new token
    const instanceToken = crypto.randomUUID();
    const instanceTokenHash = await hashToken(instanceToken);
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;

    await ctx.db.patch(instance._id, {
      instanceTokenHash,
      expiresAt,
      lastActivityAt: Date.now(),
    });

    return { instanceToken, expiresAt };
  },
});

/**
 * Revoke an agent globally (IT admin operation).
 * All instances become invalid immediately.
 */
export const revokeAgent = mutation({
  args: {
    agentId: v.string(),
    revokedBy: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const agent = await ctx.db
      .query("registeredAgents")
      .withIndex("by_agent_id", (q) => q.eq("agentId", args.agentId))
      .unique();

    if (!agent) return false;

    await ctx.db.patch(agent._id, {
      isActive: false,
      revokedAt: Date.now(),
      revokedBy: args.revokedBy,
    });

    return true;
  },
});

/**
 * Revoke a specific app instance for an agent.
 */
export const revokeAppInstance = mutation({
  args: {
    agentId: v.string(),
    appName: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const instance = await ctx.db
      .query("agentAppInstances")
      .withIndex("by_agent_and_app", (q) =>
        q.eq("agentId", args.agentId).eq("appName", args.appName),
      )
      .unique();

    if (!instance) return false;

    await ctx.db.delete(instance._id);
    return true;
  },
});

/**
 * List all registered agents (admin query).
 */
export const listAgents = query({
  args: {
    activeOnly: v.optional(v.boolean()),
  },
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
  handler: async (ctx, args) => {
    const agents = await ctx.db.query("registeredAgents").collect();

    const filtered =
      args.activeOnly !== false
        ? agents.filter((a) => a.isActive)
        : agents;

    return filtered.map((a) => ({
      agentId: a.agentId,
      employeeEmail: a.employeeEmail,
      department: a.department,
      firstRegisteredAt: a.firstRegisteredAt,
      lastSeenAt: a.lastSeenAt,
      isActive: a.isActive,
      revokedAt: a.revokedAt,
      revokedBy: a.revokedBy,
    }));
  },
});

/**
 * Configure the component (set appName and default permissions).
 * This is an internal mutation called via the client class.
 */
export const configure = mutation({
  args: {
    appName: v.string(),
    defaultPermissions: v.array(
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
            tokenBudget: v.number(),
          }),
        ),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Upsert: replace existing config
    const existing = await ctx.db.query("componentConfig").first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        appName: args.appName,
        defaultPermissions: args.defaultPermissions,
        configuredAt: Date.now(),
      });
    } else {
      await ctx.db.insert("componentConfig", {
        appName: args.appName,
        defaultPermissions: args.defaultPermissions,
        configuredAt: Date.now(),
      });
    }

    return null;
  },
});
