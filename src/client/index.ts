import { httpActionGeneric } from "convex/server";
import type {
  GenericActionCtx,
  GenericDataModel,
  GenericMutationCtx,
  GenericQueryCtx,
  FunctionHandle,
  HttpRouter,
} from "convex/server";
import type { ComponentApi } from "../component/_generated/component.js";

// Convenient context types with minimal required capabilities.
type QueryCtx = Pick<GenericQueryCtx<GenericDataModel>, "runQuery">;
type MutationCtx = Pick<
  GenericMutationCtx<GenericDataModel>,
  "runQuery" | "runMutation"
>;
type ActionCtx = Pick<
  GenericActionCtx<GenericDataModel>,
  "runQuery" | "runMutation" | "runAction"
>;

// --- Types ---

export interface FunctionDef {
  /** Alias name that agents use to call this function (e.g. "okr:getObjectives") */
  name: string;
  /** Function handle string from createFunctionHandle() */
  handle: string;
  /** Type of the Convex function */
  type: "query" | "mutation" | "action";
  /** Human-readable description */
  description?: string;
}

export interface DefaultPermission {
  pattern: string;
  permission: "allow" | "deny" | "rate_limited";
  rateLimitConfig?: {
    requestsPerHour: number;
    tokenBudget: number;
  };
}

export interface AgentBridgeConfig {
  /** Unique name identifying this app (e.g. "okr", "hr", "incentives") */
  appName: string;
  /** Default permissions applied to new agents during provisioning */
  defaultPermissions?: DefaultPermission[];
}

// --- AgentBridge Client Class ---

/**
 * Client class that wraps component calls for ergonomic use in the host app.
 *
 * Usage:
 * ```ts
 * import { AgentBridge } from "@okrlinkhub/agent-bridge";
 * import { components } from "./_generated/api";
 *
 * const bridge = new AgentBridge(components.agentBridge, { appName: "okr" });
 * ```
 */
export class AgentBridge {
  public component: ComponentApi;
  public appName: string;
  private defaultPermissions: DefaultPermission[];

  constructor(component: ComponentApi, config: AgentBridgeConfig) {
    this.component = component;
    this.appName = config.appName;
    this.defaultPermissions = config.defaultPermissions ?? [
      { pattern: "*", permission: "deny" },
    ];
  }

  /**
   * Initialize the component configuration.
   * Should be called once during app setup (e.g. in a seed/setup mutation).
   */
  async configure(ctx: MutationCtx): Promise<void> {
    await ctx.runMutation(this.component.provisioning.configure, {
      appName: this.appName,
      defaultPermissions: this.defaultPermissions,
    });
  }

  /**
   * Register a function that agents can call.
   * The host app must create the function handle via createFunctionHandle().
   */
  async registerFunction(ctx: MutationCtx, fn: FunctionDef): Promise<string> {
    return await ctx.runMutation(this.component.registry.register, {
      appName: this.appName,
      functionName: fn.name,
      functionHandle: fn.handle,
      functionType: fn.type,
      description: fn.description,
    });
  }

  /**
   * Register multiple functions in bulk.
   */
  async registerFunctions(
    ctx: MutationCtx,
    functions: FunctionDef[],
  ): Promise<string[]> {
    const ids: string[] = [];
    for (const fn of functions) {
      const id = await this.registerFunction(ctx, fn);
      ids.push(id);
    }
    return ids;
  }

  /**
   * Unregister a function.
   */
  async unregisterFunction(
    ctx: MutationCtx,
    functionName: string,
  ): Promise<boolean> {
    return await ctx.runMutation(this.component.registry.unregister, {
      appName: this.appName,
      functionName,
    });
  }

  /**
   * List all registered functions for this app.
   */
  async listFunctions(ctx: QueryCtx) {
    return await ctx.runQuery(this.component.registry.listFunctions, {
      appName: this.appName,
    });
  }

  /**
   * Generate a provisioning token (admin operation).
   * Returns the plaintext token -- store/communicate securely!
   */
  async generateProvisioningToken(
    ctx: MutationCtx,
    opts: {
      employeeEmail: string;
      department: string;
      maxApps?: number;
      expiresInDays?: number;
      createdBy: string;
    },
  ) {
    return await ctx.runMutation(
      this.component.provisioning.generateProvisioningToken,
      opts,
    );
  }

  /**
   * List all registered agents.
   */
  async listAgents(ctx: QueryCtx, activeOnly?: boolean) {
    return await ctx.runQuery(this.component.provisioning.listAgents, {
      activeOnly,
    });
  }

  /**
   * Revoke an agent globally.
   */
  async revokeAgent(
    ctx: MutationCtx,
    opts: { agentId: string; revokedBy: string },
  ): Promise<boolean> {
    return await ctx.runMutation(this.component.provisioning.revokeAgent, opts);
  }

  /**
   * Revoke a specific app instance for an agent.
   */
  async revokeAppInstance(
    ctx: MutationCtx,
    opts: { agentId: string },
  ): Promise<boolean> {
    return await ctx.runMutation(
      this.component.provisioning.revokeAppInstance,
      {
        agentId: opts.agentId,
        appName: this.appName,
      },
    );
  }

  /**
   * Set a permission for an agent.
   */
  async setPermission(
    ctx: MutationCtx,
    opts: {
      agentId: string;
      functionPattern: string;
      permission: "allow" | "deny" | "rate_limited";
      rateLimitConfig?: { requestsPerHour: number; tokenBudget: number };
      createdBy: string;
    },
  ): Promise<string> {
    return await ctx.runMutation(this.component.permissions.setPermission, {
      agentId: opts.agentId,
      appName: this.appName,
      functionPattern: opts.functionPattern,
      permission: opts.permission,
      rateLimitConfig: opts.rateLimitConfig,
      createdBy: opts.createdBy,
    });
  }

  /**
   * Remove a permission for an agent.
   */
  async removePermission(
    ctx: MutationCtx,
    opts: { agentId: string; functionPattern: string },
  ): Promise<boolean> {
    return await ctx.runMutation(this.component.permissions.removePermission, {
      agentId: opts.agentId,
      appName: this.appName,
      functionPattern: opts.functionPattern,
    });
  }

  /**
   * List permissions for an agent on this app.
   */
  async listPermissions(ctx: QueryCtx, agentId: string) {
    return await ctx.runQuery(this.component.permissions.listPermissions, {
      agentId,
      appName: this.appName,
    });
  }

  /**
   * Query access logs.
   */
  async queryAccessLog(
    ctx: QueryCtx,
    opts?: { agentId?: string; limit?: number },
  ) {
    return await ctx.runQuery(this.component.gateway.queryAccessLog, {
      agentId: opts?.agentId,
      appName: this.appName,
      limit: opts?.limit,
    });
  }

  // --- Circuit Breaker ---

  /**
   * Get the current circuit breaker status for an agent on this app.
   * Returns the counter for the current hour window, or null if none exists.
   */
  async getCircuitBreakerStatus(ctx: QueryCtx, agentId: string) {
    return await ctx.runQuery(this.component.circuitBreaker.getStatus, {
      agentId,
      appName: this.appName,
    });
  }

  /**
   * Admin: manually reset a blocked circuit breaker for an agent.
   */
  async resetCircuitBreaker(
    ctx: MutationCtx,
    agentId: string,
  ): Promise<boolean> {
    return await ctx.runMutation(this.component.circuitBreaker.resetCounter, {
      agentId,
      appName: this.appName,
    });
  }

  /**
   * Admin: list all currently blocked circuit breakers across all agents.
   */
  async listBlockedAgents(ctx: QueryCtx) {
    return await ctx.runQuery(this.component.circuitBreaker.listBlocked, {});
  }

  // --- A2A Channels ---

  /**
   * Admin: create a channel for this app.
   * Idempotent -- returns existing channel ID if it already exists.
   */
  async createChannel(
    ctx: MutationCtx,
    channelName: string,
    description?: string,
  ): Promise<string> {
    return await ctx.runMutation(this.component.channels.createChannel, {
      appName: this.appName,
      channelName,
      description,
    });
  }

  /**
   * List active channels for this app.
   */
  async listChannels(ctx: QueryCtx) {
    return await ctx.runQuery(this.component.channels.listChannels, {
      appName: this.appName,
    });
  }

  /**
   * Admin: deactivate a channel (soft delete).
   */
  async deactivateChannel(
    ctx: MutationCtx,
    channelName: string,
  ): Promise<boolean> {
    return await ctx.runMutation(this.component.channels.deactivateChannel, {
      appName: this.appName,
      channelName,
    });
  }

  /**
   * Post a message to a channel on behalf of an authenticated agent.
   */
  async postMessage(
    ctx: MutationCtx,
    opts: {
      instanceToken: string;
      channelName: string;
      payload: string;
      priority?: number;
      ttlMinutes?: number;
    },
  ) {
    return await ctx.runMutation(this.component.channels.postMessage, {
      instanceToken: opts.instanceToken,
      appName: this.appName,
      channelName: opts.channelName,
      payload: opts.payload,
      priority: opts.priority,
      ttlMinutes: opts.ttlMinutes,
    });
  }

  /**
   * Read messages from a channel on behalf of an authenticated agent.
   */
  async readMessages(
    ctx: QueryCtx,
    opts: {
      instanceToken: string;
      channelName: string;
      limit?: number;
      after?: number;
    },
  ) {
    return await ctx.runQuery(this.component.channels.readMessages, {
      instanceToken: opts.instanceToken,
      appName: this.appName,
      channelName: opts.channelName,
      limit: opts.limit,
      after: opts.after,
    });
  }

  /**
   * Get unread message count for an agent on a channel.
   */
  async getUnreadCount(
    ctx: QueryCtx,
    opts: {
      instanceToken: string;
      channelName: string;
    },
  ) {
    return await ctx.runQuery(this.component.channels.getUnreadCount, {
      instanceToken: opts.instanceToken,
      appName: this.appName,
      channelName: opts.channelName,
    });
  }
}

// --- HTTP Route Registration ---

/**
 * Register HTTP routes for the agent bridge component.
 * This exposes endpoints that OpenClaw agents call to execute functions,
 * provision themselves, and check health.
 *
 * Must be called in the host app's `convex/http.ts` file.
 *
 * @example
 * ```ts
 * import { httpRouter } from "convex/server";
 * import { registerRoutes } from "@okrlinkhub/agent-bridge";
 * import { components } from "./_generated/api";
 *
 * const http = httpRouter();
 * registerRoutes(http, components.agentBridge, { appName: "okr" });
 * export default http;
 * ```
 */
export function registerRoutes(
  http: HttpRouter,
  component: ComponentApi,
  config: { appName: string; pathPrefix?: string },
) {
  const prefix = config.pathPrefix ?? "/agent-bridge";

  // --- POST /agent-bridge/execute ---
  // Gateway: execute a registered function on behalf of an agent
  http.route({
    path: `${prefix}/execute`,
    method: "POST",
    handler: httpActionGeneric(async (ctx, request) => {
      let body: {
        instanceToken?: string;
        functionName?: string;
        args?: Record<string, unknown>;
        estimatedCost?: number;
      };
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ error: "Invalid JSON body" }, 400);
      }

      const { instanceToken, functionName, args, estimatedCost } = body;

      if (!instanceToken || !functionName) {
        return jsonResponse(
          { error: "Missing required fields: instanceToken, functionName" },
          400,
        );
      }

      // Step 1: Authorize the request (mutation -- validates token, checks permissions,
      // circuit breaker, updates counters, returns function handle)
      const authResult = await ctx.runMutation(
        component.gateway.authorizeRequest,
        {
          instanceToken,
          functionName,
          appName: config.appName,
          estimatedCost,
        },
      );

      if (!authResult.authorized) {
        const detailSuffix =
          authResult.matchedPattern && authResult.matchedPermission
            ? ` (matchedPattern="${authResult.matchedPattern}", permission="${authResult.matchedPermission}")`
            : "";
        // Log the denied access
        const permission =
          authResult.statusCode === 429 ? "rate_limited" : "deny";
        await ctx.runMutation(component.gateway.logAccess, {
          agentId: authResult.agentId ?? "unknown",
          appName: config.appName,
          functionCalled: functionName,
          permission,
          errorMessage: authResult.error + detailSuffix,
        });

        // For rate-limited responses, include Retry-After header
        if (
          authResult.statusCode === 429 &&
          authResult.retryAfterSeconds !== undefined
        ) {
          return jsonResponseWithHeaders(
            { error: authResult.error },
            authResult.statusCode,
            { "Retry-After": String(authResult.retryAfterSeconds) },
          );
        }

        return jsonResponse(
          { error: authResult.error },
          authResult.statusCode,
        );
      }

      // Step 2: Execute the function via the registered handle
      const startTime = Date.now();
      try {
        let result: unknown;

        switch (authResult.functionType) {
          case "query":
            result = await ctx.runQuery(
              authResult.functionHandle as FunctionHandle<"query">,
              args ?? {},
            );
            break;
          case "mutation":
            result = await ctx.runMutation(
              authResult.functionHandle as FunctionHandle<"mutation">,
              args ?? {},
            );
            break;
          case "action":
            result = await ctx.runAction(
              authResult.functionHandle as FunctionHandle<"action">,
              args ?? {},
            );
            break;
        }

        const durationMs = Date.now() - startTime;

        // Step 3: Log successful access
        await ctx.runMutation(component.gateway.logAccess, {
          agentId: authResult.agentId,
          appName: config.appName,
          functionCalled: functionName,
          permission: "allow",
          durationMs,
        });

        return jsonResponse({ result, durationMs }, 200);
      } catch (error: unknown) {
        const durationMs = Date.now() - startTime;
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        // Log the failed execution
        await ctx.runMutation(component.gateway.logAccess, {
          agentId: authResult.agentId,
          appName: config.appName,
          functionCalled: functionName,
          permission: "allow",
          errorMessage,
          durationMs,
        });

        return jsonResponse({ error: errorMessage }, 500);
      }
    }),
  });

  // --- POST /agent-bridge/provision ---
  // Agent self-provisioning endpoint
  http.route({
    path: `${prefix}/provision`,
    method: "POST",
    handler: httpActionGeneric(async (ctx, request) => {
      let body: { provisioningToken?: string };
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ error: "Invalid JSON body" }, 400);
      }

      const { provisioningToken } = body;

      if (!provisioningToken) {
        return jsonResponse(
          { error: "Missing required field: provisioningToken" },
          400,
        );
      }

      try {
        const result = await ctx.runMutation(
          component.provisioning.provisionAgent,
          {
            provisioningToken,
            appName: config.appName,
          },
        );

        return jsonResponse(result, 200);
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : "Provisioning failed";
        return jsonResponse({ error: errorMessage }, 400);
      }
    }),
  });

  // --- GET /agent-bridge/health ---
  // Health check endpoint
  http.route({
    path: `${prefix}/health`,
    method: "GET",
    handler: httpActionGeneric(async (ctx) => {
      try {
        const functions = await ctx.runQuery(
          component.registry.listFunctions,
          { appName: config.appName },
        );

        return jsonResponse(
          {
            status: "ok",
            appName: config.appName,
            registeredFunctions: functions.length,
            timestamp: Date.now(),
          },
          200,
        );
      } catch {
        return jsonResponse(
          {
            status: "error",
            appName: config.appName,
            timestamp: Date.now(),
          },
          500,
        );
      }
    }),
  });

  // --- POST /agent-bridge/channels ---
  // Create a new channel (admin operation)
  http.route({
    path: `${prefix}/channels`,
    method: "POST",
    handler: httpActionGeneric(async (ctx, request) => {
      let body: {
        channelName?: string;
        description?: string;
      };
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ error: "Invalid JSON body" }, 400);
      }

      const { channelName, description } = body;

      if (!channelName) {
        return jsonResponse(
          { error: "Missing required field: channelName" },
          400,
        );
      }

      try {
        const channelId = await ctx.runMutation(
          component.channels.createChannel,
          {
            appName: config.appName,
            channelName,
            description,
          },
        );

        return jsonResponse({ channelId, channelName }, 200);
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : "Failed to create channel";
        return jsonResponse({ error: errorMessage }, 500);
      }
    }),
  });

  // --- GET /agent-bridge/channels ---
  // List active channels for this app
  http.route({
    path: `${prefix}/channels`,
    method: "GET",
    handler: httpActionGeneric(async (ctx) => {
      try {
        const channels = await ctx.runQuery(
          component.channels.listChannels,
          { appName: config.appName },
        );

        return jsonResponse({ channels }, 200);
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : "Failed to list channels";
        return jsonResponse({ error: errorMessage }, 500);
      }
    }),
  });

  // --- POST /agent-bridge/channels/post ---
  // Post a message to a channel (requires instanceToken)
  http.route({
    path: `${prefix}/channels/post`,
    method: "POST",
    handler: httpActionGeneric(async (ctx, request) => {
      let body: {
        instanceToken?: string;
        channelName?: string;
        payload?: string;
        priority?: number;
        ttlMinutes?: number;
      };
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ error: "Invalid JSON body" }, 400);
      }

      const { instanceToken, channelName, payload, priority, ttlMinutes } =
        body;

      if (!instanceToken || !channelName || !payload) {
        return jsonResponse(
          {
            error:
              "Missing required fields: instanceToken, channelName, payload",
          },
          400,
        );
      }

      try {
        const result = await ctx.runMutation(
          component.channels.postMessage,
          {
            instanceToken,
            appName: config.appName,
            channelName,
            payload,
            priority,
            ttlMinutes,
          },
        );

        return jsonResponse(result, 200);
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : "Failed to post message";
        // Map authentication errors to appropriate status codes
        if (
          errorMessage.includes("Invalid instance token") ||
          errorMessage.includes("expired")
        ) {
          return jsonResponse({ error: errorMessage }, 401);
        }
        if (
          errorMessage.includes("revoked") ||
          errorMessage.includes("does not match")
        ) {
          return jsonResponse({ error: errorMessage }, 403);
        }
        return jsonResponse({ error: errorMessage }, 500);
      }
    }),
  });

  // --- POST /agent-bridge/channels/read ---
  // Read messages from a channel (POST because it has body with filters)
  http.route({
    path: `${prefix}/channels/read`,
    method: "POST",
    handler: httpActionGeneric(async (ctx, request) => {
      let body: {
        instanceToken?: string;
        channelName?: string;
        limit?: number;
        after?: number;
      };
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ error: "Invalid JSON body" }, 400);
      }

      const { instanceToken, channelName, limit, after } = body;

      if (!instanceToken || !channelName) {
        return jsonResponse(
          {
            error: "Missing required fields: instanceToken, channelName",
          },
          400,
        );
      }

      try {
        const messages = await ctx.runQuery(
          component.channels.readMessages,
          {
            instanceToken,
            appName: config.appName,
            channelName,
            limit,
            after,
          },
        );

        return jsonResponse({ messages }, 200);
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : "Failed to read messages";
        if (
          errorMessage.includes("Invalid instance token") ||
          errorMessage.includes("expired")
        ) {
          return jsonResponse({ error: errorMessage }, 401);
        }
        if (
          errorMessage.includes("revoked") ||
          errorMessage.includes("does not match")
        ) {
          return jsonResponse({ error: errorMessage }, 403);
        }
        return jsonResponse({ error: errorMessage }, 500);
      }
    }),
  });

  // --- POST /agent-bridge/channels/mark-read ---
  // Mark a message as read by an agent
  http.route({
    path: `${prefix}/channels/mark-read`,
    method: "POST",
    handler: httpActionGeneric(async (ctx, request) => {
      let body: {
        instanceToken?: string;
        messageId?: string;
      };
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ error: "Invalid JSON body" }, 400);
      }

      const { instanceToken, messageId } = body;

      if (!instanceToken || !messageId) {
        return jsonResponse(
          {
            error: "Missing required fields: instanceToken, messageId",
          },
          400,
        );
      }

      try {
        const success = await ctx.runMutation(
          component.channels.markAsRead,
          {
            instanceToken,
            appName: config.appName,
            messageId,
          },
        );

        return jsonResponse({ success }, 200);
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : "Failed to mark as read";
        if (
          errorMessage.includes("Invalid instance token") ||
          errorMessage.includes("expired")
        ) {
          return jsonResponse({ error: errorMessage }, 401);
        }
        return jsonResponse({ error: errorMessage }, 500);
      }
    }),
  });
}

// --- Helpers ---

function jsonResponse(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function jsonResponseWithHeaders(
  data: unknown,
  status: number,
  extraHeaders: Record<string, string>,
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}
