import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import type { MutationCtx, QueryCtx } from "./_generated/server.js";

// --- Token hashing utility (shared with gateway.ts) ---

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// --- Instance verification helper ---

/**
 * Verify an instance token and return the agent info.
 * Throws if the token is invalid, expired, or doesn't match the expected app.
 */
async function verifyInstanceToken(
  ctx: QueryCtx | MutationCtx,
  instanceToken: string,
  appName: string,
): Promise<{ agentId: string; appName: string }> {
  const tokenHash = await hashToken(instanceToken);
  const instance = await ctx.db
    .query("agentAppInstances")
    .withIndex("by_instance_token_hash", (q) =>
      q.eq("instanceTokenHash", tokenHash),
    )
    .unique();

  if (!instance) {
    throw new Error("Invalid instance token");
  }

  if (instance.expiresAt < Date.now()) {
    throw new Error("Instance token has expired");
  }

  if (instance.appName !== appName) {
    throw new Error("Token does not match this app");
  }

  // Verify agent is active
  const agent = await ctx.db
    .query("registeredAgents")
    .withIndex("by_agent_id", (q) => q.eq("agentId", instance.agentId))
    .unique();

  if (!agent || !agent.isActive) {
    throw new Error("Agent has been revoked");
  }

  return { agentId: instance.agentId, appName: instance.appName };
}

// --- Channel Management ---

/**
 * Create a channel for an app.
 * Idempotent: if the channel already exists, returns the existing ID.
 */
export const createChannel = mutation({
  args: {
    appName: v.string(),
    channelName: v.string(),
    description: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    // Check if channel already exists
    const existing = await ctx.db
      .query("appChannels")
      .withIndex("by_appName_and_channelName", (q) =>
        q.eq("appName", args.appName).eq("channelName", args.channelName),
      )
      .unique();

    if (existing) {
      return existing._id;
    }

    const id = await ctx.db.insert("appChannels", {
      appName: args.appName,
      channelName: args.channelName,
      description: args.description,
      createdAt: Date.now(),
      isActive: true,
    });

    return id;
  },
});

/**
 * List active channels for an app.
 */
export const listChannels = query({
  args: {
    appName: v.string(),
  },
  returns: v.array(
    v.object({
      channelName: v.string(),
      description: v.optional(v.string()),
      createdAt: v.number(),
      isActive: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const channels = await ctx.db
      .query("appChannels")
      .withIndex("by_appName_and_channelName", (q) =>
        q.eq("appName", args.appName),
      )
      .collect();

    return channels
      .filter((c) => c.isActive)
      .map((c) => ({
        channelName: c.channelName,
        description: c.description,
        createdAt: c.createdAt,
        isActive: c.isActive,
      }));
  },
});

/**
 * Deactivate a channel (soft delete).
 */
export const deactivateChannel = mutation({
  args: {
    appName: v.string(),
    channelName: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const channel = await ctx.db
      .query("appChannels")
      .withIndex("by_appName_and_channelName", (q) =>
        q.eq("appName", args.appName).eq("channelName", args.channelName),
      )
      .unique();

    if (!channel) {
      return false;
    }

    await ctx.db.patch(channel._id, { isActive: false });
    return true;
  },
});

// --- Message Operations ---

/**
 * Post a message to a channel.
 * Requires a valid instanceToken for authentication.
 */
export const postMessage = mutation({
  args: {
    instanceToken: v.string(),
    appName: v.string(),
    channelName: v.string(),
    payload: v.string(),
    priority: v.optional(v.number()),
    ttlMinutes: v.optional(v.number()),
  },
  returns: v.object({
    success: v.boolean(),
    messageId: v.string(),
  }),
  handler: async (ctx, args) => {
    // Verify the agent's identity
    const verified = await verifyInstanceToken(
      ctx,
      args.instanceToken,
      args.appName,
    );

    // Verify channel exists and is active
    const channel = await ctx.db
      .query("appChannels")
      .withIndex("by_appName_and_channelName", (q) =>
        q.eq("appName", args.appName).eq("channelName", args.channelName),
      )
      .unique();

    if (!channel || !channel.isActive) {
      throw new Error(
        `Channel "${args.channelName}" not found or inactive in app "${args.appName}"`,
      );
    }

    const ttlMs = (args.ttlMinutes ?? 60) * 60 * 1000;
    const messageId = crypto.randomUUID();
    const now = Date.now();

    await ctx.db.insert("channelMessages", {
      appName: args.appName,
      channelName: args.channelName,
      messageId,
      fromAgentId: verified.agentId,
      payload: args.payload,
      metadata: {
        priority: args.priority ?? 5,
        ttl: ttlMs,
      },
      sentAt: now,
      expiresAt: now + ttlMs,
      readBy: [],
    });

    return { success: true, messageId };
  },
});

/**
 * Read messages from a channel with cursor-based pagination.
 * Filters out expired messages. Returns messages in descending order (newest first).
 */
export const readMessages = query({
  args: {
    instanceToken: v.string(),
    appName: v.string(),
    channelName: v.string(),
    limit: v.optional(v.number()),
    after: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      messageId: v.string(),
      fromAgentId: v.string(),
      payload: v.string(),
      metadata: v.object({
        priority: v.number(),
        ttl: v.number(),
      }),
      sentAt: v.number(),
      expiresAt: v.number(),
      readBy: v.array(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    // Verify the agent's identity
    await verifyInstanceToken(ctx, args.instanceToken, args.appName);

    const now = Date.now();
    const limit = args.limit ?? 20;

    let messagesQuery;
    if (args.after !== undefined) {
      messagesQuery = ctx.db
        .query("channelMessages")
        .withIndex("by_appName_and_channelName_and_sentAt", (q) =>
          q
            .eq("appName", args.appName)
            .eq("channelName", args.channelName)
            .gt("sentAt", args.after!),
        );
    } else {
      messagesQuery = ctx.db
        .query("channelMessages")
        .withIndex("by_appName_and_channelName_and_sentAt", (q) =>
          q
            .eq("appName", args.appName)
            .eq("channelName", args.channelName),
        );
    }

    const messages = await messagesQuery.order("desc").take(limit * 2);

    // Filter out expired messages and take the requested limit
    const validMessages = messages
      .filter((m) => m.expiresAt > now)
      .slice(0, limit);

    return validMessages.map((m) => ({
      messageId: m.messageId,
      fromAgentId: m.fromAgentId,
      payload: m.payload,
      metadata: m.metadata,
      sentAt: m.sentAt,
      expiresAt: m.expiresAt,
      readBy: m.readBy,
    }));
  },
});

/**
 * Mark a message as read by an agent.
 * Adds the agentId to the readBy array if not already present.
 */
export const markAsRead = mutation({
  args: {
    instanceToken: v.string(),
    appName: v.string(),
    messageId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const verified = await verifyInstanceToken(
      ctx,
      args.instanceToken,
      args.appName,
    );

    // Find the message by messageId
    const messages = await ctx.db
      .query("channelMessages")
      .withIndex("by_appName_and_channelName_and_sentAt", (q) =>
        q.eq("appName", args.appName),
      )
      .collect();

    const message = messages.find((m) => m.messageId === args.messageId);

    if (!message) {
      return false;
    }

    if (message.readBy.includes(verified.agentId)) {
      // Already marked as read
      return true;
    }

    await ctx.db.patch(message._id, {
      readBy: [...message.readBy, verified.agentId],
    });

    return true;
  },
});

/**
 * Get count of unread messages for an agent on a channel.
 * Only counts non-expired messages.
 */
export const getUnreadCount = query({
  args: {
    instanceToken: v.string(),
    appName: v.string(),
    channelName: v.string(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const verified = await verifyInstanceToken(
      ctx,
      args.instanceToken,
      args.appName,
    );

    const now = Date.now();

    const messages = await ctx.db
      .query("channelMessages")
      .withIndex("by_appName_and_channelName_and_sentAt", (q) =>
        q
          .eq("appName", args.appName)
          .eq("channelName", args.channelName),
      )
      .collect();

    const unread = messages.filter(
      (m) => m.expiresAt > now && !m.readBy.includes(verified.agentId),
    );

    return unread.length;
  },
});
