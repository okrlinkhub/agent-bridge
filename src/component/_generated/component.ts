/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    channels: {
      createChannel: FunctionReference<
        "mutation",
        "internal",
        { appName: string; channelName: string; description?: string },
        string,
        Name
      >;
      deactivateChannel: FunctionReference<
        "mutation",
        "internal",
        { appName: string; channelName: string },
        boolean,
        Name
      >;
      getUnreadCount: FunctionReference<
        "query",
        "internal",
        { appName: string; channelName: string; instanceToken: string },
        number,
        Name
      >;
      listChannels: FunctionReference<
        "query",
        "internal",
        { appName: string },
        Array<{
          channelName: string;
          createdAt: number;
          description?: string;
          isActive: boolean;
        }>,
        Name
      >;
      markAsRead: FunctionReference<
        "mutation",
        "internal",
        { appName: string; instanceToken: string; messageId: string },
        boolean,
        Name
      >;
      postMessage: FunctionReference<
        "mutation",
        "internal",
        {
          appName: string;
          channelName: string;
          instanceToken: string;
          payload: string;
          priority?: number;
          ttlMinutes?: number;
        },
        { messageId: string; success: boolean },
        Name
      >;
      readMessages: FunctionReference<
        "query",
        "internal",
        {
          after?: number;
          appName: string;
          channelName: string;
          instanceToken: string;
          limit?: number;
        },
        Array<{
          expiresAt: number;
          fromAgentId: string;
          messageId: string;
          metadata: { priority: number; ttl: number };
          payload: string;
          readBy: Array<string>;
          sentAt: number;
        }>,
        Name
      >;
    };
    circuitBreaker: {
      checkAndIncrement: FunctionReference<
        "mutation",
        "internal",
        {
          agentId: string;
          appName: string;
          estimatedCost: number;
          limits: { requestsPerHour: number; tokenBudget: number };
        },
        {
          allowed: boolean;
          currentCount: number;
          currentTokens: number;
          reason?: string;
        },
        Name
      >;
      getStatus: FunctionReference<
        "query",
        "internal",
        { agentId: string; appName: string },
        {
          agentId: string;
          appName: string;
          blockedAt?: number;
          blockedReason?: string;
          isBlocked: boolean;
          requestCount: number;
          tokenEstimate: number;
          windowHour: string;
        } | null,
        Name
      >;
      listBlocked: FunctionReference<
        "query",
        "internal",
        {},
        Array<{
          agentId: string;
          appName: string;
          blockedAt?: number;
          blockedReason?: string;
          isBlocked: boolean;
          requestCount: number;
          tokenEstimate: number;
          windowHour: string;
        }>,
        Name
      >;
      resetCounter: FunctionReference<
        "mutation",
        "internal",
        { agentId: string; appName: string },
        boolean,
        Name
      >;
    };
    gateway: {
      authorizeRequest: FunctionReference<
        "mutation",
        "internal",
        {
          appName: string;
          estimatedCost?: number;
          functionName: string;
          instanceToken: string;
        },
        | {
            agentId: string;
            appName: string;
            authorized: true;
            functionHandle: string;
            functionType: "query" | "mutation" | "action";
          }
        | {
            agentId?: string;
            authorized: false;
            error: string;
            matchedPattern?: string;
            matchedPermission?: "allow" | "deny" | "rate_limited";
            retryAfterSeconds?: number;
            statusCode: number;
          },
        Name
      >;
      logAccess: FunctionReference<
        "mutation",
        "internal",
        {
          agentId: string;
          appName: string;
          durationMs?: number;
          errorMessage?: string;
          functionCalled: string;
          permission: string;
        },
        null,
        Name
      >;
      queryAccessLog: FunctionReference<
        "query",
        "internal",
        { agentId?: string; appName?: string; limit?: number },
        Array<{
          agentId: string;
          appName: string;
          durationMs?: number;
          errorMessage?: string;
          functionCalled: string;
          permission: string;
          timestamp: number;
        }>,
        Name
      >;
    };
    permissions: {
      checkPermission: FunctionReference<
        "query",
        "internal",
        { agentId: string; appName: string; functionName: string },
        {
          matchedPattern?: string;
          permission: "allow" | "deny" | "rate_limited";
          rateLimitConfig?: { requestsPerHour: number; tokenBudget: number };
        },
        Name
      >;
      clearPermissions: FunctionReference<
        "mutation",
        "internal",
        { agentId: string; appName: string },
        number,
        Name
      >;
      debugMatchPermission: FunctionReference<
        "query",
        "internal",
        { agentId: string; appName: string; functionName: string },
        {
          bestMatch?: {
            functionPattern: string;
            permission: "allow" | "deny" | "rate_limited";
            specificity: number;
          };
          functionName: string;
          matches: Array<{
            functionPattern: string;
            permission: "allow" | "deny" | "rate_limited";
            specificity: number;
          }>;
          permissions: Array<{
            functionPattern: string;
            permission: "allow" | "deny" | "rate_limited";
            specificity: number;
          }>;
        },
        Name
      >;
      listPermissions: FunctionReference<
        "query",
        "internal",
        { agentId: string; appName: string },
        Array<{
          createdAt: number;
          createdBy: string;
          functionPattern: string;
          permission: "allow" | "deny" | "rate_limited";
          rateLimitConfig?: { requestsPerHour: number; tokenBudget: number };
        }>,
        Name
      >;
      removePermission: FunctionReference<
        "mutation",
        "internal",
        { agentId: string; appName: string; functionPattern: string },
        boolean,
        Name
      >;
      setPermission: FunctionReference<
        "mutation",
        "internal",
        {
          agentId: string;
          appName: string;
          createdBy: string;
          functionPattern: string;
          permission: "allow" | "deny" | "rate_limited";
          rateLimitConfig?: { requestsPerHour: number; tokenBudget: number };
        },
        string,
        Name
      >;
    };
    provisioning: {
      configure: FunctionReference<
        "mutation",
        "internal",
        {
          appName: string;
          defaultPermissions: Array<{
            pattern: string;
            permission: "allow" | "deny" | "rate_limited";
            rateLimitConfig?: { requestsPerHour: number; tokenBudget: number };
          }>;
        },
        null,
        Name
      >;
      generateProvisioningToken: FunctionReference<
        "mutation",
        "internal",
        {
          createdBy: string;
          department: string;
          employeeEmail: string;
          expiresInDays?: number;
          maxApps?: number;
        },
        { expiresAt: number; token: string },
        Name
      >;
      listAgents: FunctionReference<
        "query",
        "internal",
        { activeOnly?: boolean },
        Array<{
          agentId: string;
          department: string;
          employeeEmail: string;
          firstRegisteredAt: number;
          isActive: boolean;
          lastSeenAt: number;
          revokedAt?: number;
          revokedBy?: string;
        }>,
        Name
      >;
      provisionAgent: FunctionReference<
        "mutation",
        "internal",
        { appName: string; provisioningToken: string },
        {
          agentId: string;
          appName: string;
          expiresAt: number;
          instanceToken: string;
          message: string;
        },
        Name
      >;
      refreshInstanceToken: FunctionReference<
        "mutation",
        "internal",
        { agentId: string; appName: string; currentTokenHash: string },
        { expiresAt: number; instanceToken: string },
        Name
      >;
      revokeAgent: FunctionReference<
        "mutation",
        "internal",
        { agentId: string; revokedBy: string },
        boolean,
        Name
      >;
      revokeAppInstance: FunctionReference<
        "mutation",
        "internal",
        { agentId: string; appName: string },
        boolean,
        Name
      >;
    };
    registry: {
      getHandle: FunctionReference<
        "query",
        "internal",
        { appName: string; functionName: string },
        null | {
          description?: string;
          functionHandle: string;
          functionName: string;
          functionType: "query" | "mutation" | "action";
        },
        Name
      >;
      listFunctions: FunctionReference<
        "query",
        "internal",
        { appName: string },
        Array<{
          description?: string;
          functionName: string;
          functionType: "query" | "mutation" | "action";
          registeredAt: number;
        }>,
        Name
      >;
      register: FunctionReference<
        "mutation",
        "internal",
        {
          appName: string;
          description?: string;
          functionHandle: string;
          functionName: string;
          functionType: "query" | "mutation" | "action";
        },
        string,
        Name
      >;
      unregister: FunctionReference<
        "mutation",
        "internal",
        { appName: string; functionName: string },
        boolean,
        Name
      >;
    };
  };
