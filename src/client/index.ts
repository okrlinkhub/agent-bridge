import { httpActionGeneric } from "convex/server";
import type {
  FunctionHandle,
  GenericDataModel,
  GenericMutationCtx,
  HttpRouter,
} from "convex/server";
import type { ComponentApi } from "../component/_generated/component.js";

export type AgentBridgeFunctionType = "query" | "mutation" | "action";

type UnknownFunctionReference = unknown;

export interface AgentBridgeFunctionDefinition {
  ref: UnknownFunctionReference;
  type?: AgentBridgeFunctionType;
}

export interface AgentBridgeFunctionMetadata {
  description?: string;
  riskLevel?: "low" | "medium" | "high";
  category?: string;
}

export interface AgentBridgeConfig {
  functions: Record<
    string,
    UnknownFunctionReference | AgentBridgeFunctionDefinition
  >;
  metadata?: Record<string, AgentBridgeFunctionMetadata>;
}

export function defineAgentBridgeConfig(
  config: AgentBridgeConfig,
): AgentBridgeConfig {
  return config;
}

export function generateAgentApiKey(prefix: string = "abk_live"): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${prefix}_${token}`;
}

type NormalizedFunctionDefinition = {
  ref: UnknownFunctionReference;
  type: AgentBridgeFunctionType;
  metadata?: AgentBridgeFunctionMetadata;
};

type NormalizedAgentBridgeConfig = {
  functions: Record<string, NormalizedFunctionDefinition>;
};

export function detectFunctionType(
  fnRef: UnknownFunctionReference,
): AgentBridgeFunctionType | null {
  if (!fnRef || typeof fnRef !== "object") {
    return null;
  }

  if ("_type" in fnRef) {
    const candidate = (fnRef as { _type?: unknown })._type;
    if (
      candidate === "query" ||
      candidate === "mutation" ||
      candidate === "action"
    ) {
      return candidate;
    }
  }

  return null;
}

export function normalizeAgentBridgeConfig(
  config: AgentBridgeConfig,
): NormalizedAgentBridgeConfig {
  const functionEntries = Object.entries(config.functions);
  if (functionEntries.length === 0) {
    throw new Error("agent-bridge config requires at least one function");
  }

  const normalizedFunctions: Record<string, NormalizedFunctionDefinition> = {};
  for (const [functionKey, entry] of functionEntries) {
    if (!functionKey.trim()) {
      throw new Error("function keys cannot be empty");
    }

    const metadata = config.metadata?.[functionKey];
    const hasExplicitConfig =
      entry && typeof entry === "object" && "ref" in (entry as object);
    const ref = hasExplicitConfig
      ? (entry as AgentBridgeFunctionDefinition).ref
      : entry;
    const explicitType = hasExplicitConfig
      ? (entry as AgentBridgeFunctionDefinition).type
      : undefined;

    const detectedType = detectFunctionType(ref);
    const functionType = explicitType ?? detectedType;
    if (!functionType) {
      throw new Error(
        `Cannot detect function type for "${functionKey}". Set { ref, type } explicitly in agent-bridge config.`,
      );
    }

    normalizedFunctions[functionKey] = {
      ref,
      type: functionType,
      metadata,
    };
  }

  return { functions: normalizedFunctions };
}

type ExecuteRequestBody = {
  functionKey?: string;
  args?: Record<string, unknown>;
  estimatedCost?: number;
};

export function registerRoutes(
  http: HttpRouter,
  component: ComponentApi,
  bridgeConfig: AgentBridgeConfig,
  options?: { pathPrefix?: string },
) {
  const prefix = options?.pathPrefix ?? "/agent";
  const normalizedConfig = normalizeAgentBridgeConfig(bridgeConfig);
  const availableFunctionKeys = Object.keys(normalizedConfig.functions);

  http.route({
    path: `${prefix}/execute`,
    method: "POST",
    handler: httpActionGeneric(async (ctx, request) => {
      const apiKey = request.headers.get("X-Agent-API-Key");
      if (!apiKey) {
        return jsonResponse({ success: false, error: "Missing API key" }, 401);
      }

      let body: ExecuteRequestBody;
      try {
        body = await request.json();
      } catch {
        return jsonResponse(
          { success: false, error: "Invalid JSON body" },
          400,
        );
      }

      const functionKey = body.functionKey?.trim();
      if (!functionKey) {
        return jsonResponse(
          { success: false, error: "Missing required field: functionKey" },
          400,
        );
      }

      const functionDef = normalizedConfig.functions[functionKey];
      if (!functionDef) {
        return jsonResponse(
          { success: false, error: `Function "${functionKey}" not found` },
          404,
        );
      }

      const authResult = await ctx.runMutation(component.gateway.authorizeRequest, {
        apiKey,
        functionKey,
        estimatedCost: body.estimatedCost,
      });

      if (!authResult.authorized) {
        const response = jsonResponse(
          { success: false, error: authResult.error },
          authResult.statusCode,
        );
        if (authResult.statusCode === 429) {
          response.headers.set(
            "Retry-After",
            String(authResult.retryAfterSeconds ?? 3600),
          );
        }
        return response;
      }

      const startTime = Date.now();
      try {
        const args = body.args ?? {};
        let result: unknown;
        if (functionDef.type === "query") {
          result = await ctx.runQuery(
            functionDef.ref as FunctionHandle<"query">,
            args,
          );
        } else if (functionDef.type === "mutation") {
          result = await ctx.runMutation(
            functionDef.ref as FunctionHandle<"mutation">,
            args,
          );
        } else {
          result = await ctx.runAction(
            functionDef.ref as FunctionHandle<"action">,
            args,
          );
        }

        await ctx.runMutation(component.gateway.logAccess, {
          agentId: authResult.agentId,
          functionKey,
          args,
          result,
          duration: Date.now() - startTime,
          timestamp: Date.now(),
        });

        return jsonResponse({ success: true, result }, 200);
      } catch (error: unknown) {
        const errorMessage =
          error && typeof error === "object" && "message" in error
            ? (error.message as string)
            : "Unknown error";

        await ctx.runMutation(component.gateway.logAccess, {
          agentId: authResult.agentId,
          functionKey,
          args: body.args ?? {},
          error: errorMessage,
          duration: Date.now() - startTime,
          timestamp: Date.now(),
        });

        return jsonResponse({ success: false, error: errorMessage }, 500);
      }
    }),
  });

  http.route({
    path: `${prefix}/functions`,
    method: "GET",
    handler: httpActionGeneric(async () => {
      const functions = availableFunctionKeys.map((functionKey) => ({
        functionKey,
        type: normalizedConfig.functions[functionKey].type,
        metadata: normalizedConfig.functions[functionKey].metadata,
      }));
      return jsonResponse({ functions }, 200);
    }),
  });
}

type PermissionRule = {
  pattern: string;
  permission: "allow" | "deny" | "rate_limited";
  rateLimitConfig?: {
    requestsPerHour: number;
    tokenBudget?: number;
  };
};

type MutationCtx = Pick<GenericMutationCtx<GenericDataModel>, "runMutation">;

export async function setAgentPermissions(
  ctx: MutationCtx,
  component: ComponentApi,
  args: {
    agentId: string;
    rules: PermissionRule[];
    config: AgentBridgeConfig;
  },
) {
  const availableFunctionKeys = Object.keys(args.config.functions);
  return await ctx.runMutation(component.permissions.setAgentPermissions, {
    agentId: args.agentId,
    rules: args.rules,
    availableFunctionKeys,
  });
}

export async function setFunctionOverrides(
  ctx: MutationCtx,
  component: ComponentApi,
  args: {
    overrides: Array<{
      key: string;
      enabled: boolean;
      globalRateLimit?: number;
    }>;
    config: AgentBridgeConfig;
  },
) {
  const availableFunctionKeys = Object.keys(args.config.functions);
  return await ctx.runMutation(component.permissions.setFunctionOverrides, {
    overrides: args.overrides,
    availableFunctionKeys,
  });
}

export function listConfiguredFunctions(config: AgentBridgeConfig) {
  const normalizedConfig = normalizeAgentBridgeConfig(config);
  return Object.entries(normalizedConfig.functions).map(
    ([functionKey, functionDef]) => ({
      functionKey,
      type: functionDef.type,
      metadata: functionDef.metadata,
    }),
  );
}

function jsonResponse(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
