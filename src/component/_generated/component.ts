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
    agents: {
      createAgent: FunctionReference<
        "mutation",
        "internal",
        {
          apiKey: string;
          appKey?: string;
          enabled?: boolean;
          name: string;
          rateLimit?: number;
        },
        { agentId: string },
        Name
      >;
      listAgents: FunctionReference<
        "query",
        "internal",
        {},
        Array<{
          _id: string;
          appKey?: string;
          createdAt: number;
          enabled: boolean;
          lastUsed?: number;
          name: string;
          rateLimit: number;
        }>,
        Name
      >;
      rotateApiKey: FunctionReference<
        "mutation",
        "internal",
        { agentId: string; newApiKey: string },
        null,
        Name
      >;
      updateAgent: FunctionReference<
        "mutation",
        "internal",
        {
          agentId: string;
          appKey?: string;
          enabled?: boolean;
          name?: string;
          rateLimit?: number;
        },
        null,
        Name
      >;
    };
    gateway: {
      authorizeByAppKey: FunctionReference<
        "mutation",
        "internal",
        { appKey: string; estimatedCost?: number; functionKey: string },
        | { agentId: string; authorized: true }
        | {
            agentId?: string;
            authorized: false;
            error: string;
            retryAfterSeconds?: number;
            statusCode: number;
          },
        Name
      >;
      authorizeRequest: FunctionReference<
        "mutation",
        "internal",
        { apiKey: string; estimatedCost?: number; functionKey: string },
        | { agentId: string; authorized: true }
        | {
            agentId?: string;
            authorized: false;
            error: string;
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
          args: any;
          duration: number;
          error?: string;
          functionKey: string;
          result?: any;
          timestamp: number;
        },
        null,
        Name
      >;
      queryAccessLog: FunctionReference<
        "query",
        "internal",
        { agentId?: string; functionKey?: string; limit?: number },
        Array<{
          _id: string;
          agentId: string;
          args: any;
          duration: number;
          error?: string;
          functionKey: string;
          result?: any;
          timestamp: number;
        }>,
        Name
      >;
    };
    permissions: {
      listAgentPermissions: FunctionReference<
        "query",
        "internal",
        { agentId: string },
        Array<{
          functionPattern: string;
          permission: "allow" | "deny" | "rate_limited";
          rateLimitConfig?: { requestsPerHour: number; tokenBudget?: number };
          updatedAt: number;
        }>,
        Name
      >;
      listFunctionOverrides: FunctionReference<
        "query",
        "internal",
        {},
        Array<{ enabled: boolean; globalRateLimit?: number; key: string }>,
        Name
      >;
      setAgentPermissions: FunctionReference<
        "mutation",
        "internal",
        {
          agentId: string;
          availableFunctionKeys: Array<string>;
          rules: Array<{
            pattern: string;
            permission: "allow" | "deny" | "rate_limited";
            rateLimitConfig?: { requestsPerHour: number; tokenBudget?: number };
          }>;
        },
        number,
        Name
      >;
      setFunctionOverrides: FunctionReference<
        "mutation",
        "internal",
        {
          availableFunctionKeys: Array<string>;
          overrides: Array<{
            enabled: boolean;
            globalRateLimit?: number;
            key: string;
          }>;
        },
        number,
        Name
      >;
    };
  };
