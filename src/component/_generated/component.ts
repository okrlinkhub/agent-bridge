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
          appUserSubjectHash?: string;
          args: any;
          duration: number;
          error?: string;
          errorCode?: string;
          functionKey: string;
          linkStatus?: string;
          linkedProvider?: string;
          providerUserIdHash?: string;
          rateLimited?: boolean;
          result?: any;
          serviceId?: string;
          timestamp: number;
        },
        null,
        Name
      >;
      queryAccessLog: FunctionReference<
        "query",
        "internal",
        {
          agentId?: string;
          functionKey?: string;
          limit?: number;
          serviceId?: string;
        },
        Array<{
          _id: string;
          agentId: string;
          appUserSubjectHash?: string;
          args: any;
          duration: number;
          error?: string;
          errorCode?: string;
          functionKey: string;
          linkStatus?: string;
          linkedProvider?: string;
          providerUserIdHash?: string;
          rateLimited?: boolean;
          result?: any;
          serviceId?: string;
          timestamp: number;
        }>,
        Name
      >;
    };
    linking: {
      listLinks: FunctionReference<
        "query",
        "internal",
        {
          appKey?: string;
          limit?: number;
          provider?: string;
          status?: "active" | "revoked" | "expired";
        },
        Array<{
          _creationTime: number;
          _id: string;
          appKey: string;
          appUserSubject: string;
          createdAt: number;
          expiresAt?: number;
          lastUsedAt?: number;
          metadata?: any;
          provider: string;
          providerUserId: string;
          refreshTokenCiphertext?: string;
          refreshTokenExpiresAt?: number;
          revokedAt?: number;
          status: "active" | "revoked" | "expired";
          tokenVersion?: number;
          updatedAt: number;
        }>,
        Name
      >;
      resolveLink: FunctionReference<
        "mutation",
        "internal",
        {
          appKey: string;
          extendExpiryDaysOnUse?: number;
          maxRequestsPerWindow?: number;
          provider: string;
          providerUserId: string;
          windowSeconds?: number;
        },
        | {
            link: {
              _creationTime: number;
              _id: string;
              appKey: string;
              appUserSubject: string;
              createdAt: number;
              expiresAt?: number;
              lastUsedAt?: number;
              metadata?: any;
              provider: string;
              providerUserId: string;
              refreshTokenCiphertext?: string;
              refreshTokenExpiresAt?: number;
              revokedAt?: number;
              status: "active" | "revoked" | "expired";
              tokenVersion?: number;
              updatedAt: number;
            };
            ok: true;
          }
        | {
            errorCode:
              | "link_not_found"
              | "link_revoked"
              | "link_expired"
              | "link_rate_limited";
            ok: false;
            retryAfterSeconds?: number;
            statusCode: number;
          },
        Name
      >;
      revokeLink: FunctionReference<
        "mutation",
        "internal",
        {
          appKey?: string;
          linkId?: string;
          provider?: string;
          providerUserId?: string;
        },
        { linkId?: string; revoked: boolean },
        Name
      >;
      upsertLink: FunctionReference<
        "mutation",
        "internal",
        {
          appKey: string;
          appUserSubject: string;
          expiresInDays?: number;
          metadata?: any;
          provider: string;
          providerUserId: string;
          refreshTokenCiphertext?: string;
          refreshTokenExpiresAt?: number;
          tokenVersion?: number;
        },
        { created: boolean; expiresAt?: number; linkId: string },
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
