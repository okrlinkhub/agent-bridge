import { httpActionGeneric } from "convex/server";
import type {
  FunctionHandle,
  GenericDataModel,
  GenericMutationCtx,
  HttpRouter,
} from "convex/server";
import type { ComponentApi } from "../component/_generated/component.js";
export {
  buildAgentBridgeStrictHeaders,
  createAuth0TokenAdapter,
  createCustomOidcTokenAdapter,
  createNextAuthConvexTokenAdapter,
  decodeJwtClaims,
  resolveUserToken,
  validateJwtClaims,
} from "./userAuth.js";
export type {
  AgentBridgeStrictHeadersInput,
  JwtClaimValidationOptions,
  JwtClaimValidationResult,
  JwtClaims,
  NextAuthSessionLike,
  TokenSource,
  TokenSourceAdapter,
} from "./userAuth.js";

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
  authMode?: "service" | "user";
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
  return generateKeyWithPrefix(prefix);
}

export function generateAgentBridgeServiceKey(
  prefix: string = "abs_live",
): string {
  return generateKeyWithPrefix(prefix);
}

function generateKeyWithPrefix(prefix: string): string {
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

type RegisterRoutesOptions = {
  pathPrefix?: string;
  serviceKeys?: Record<string, string>;
  serviceKeysEnvVar?: string;
  auditHashSaltEnvVar?: string;
  linkingMode?: "component_api_only";
};

export function registerRoutes(
  http: HttpRouter,
  component: ComponentApi,
  bridgeConfig: AgentBridgeConfig,
  options?: RegisterRoutesOptions,
) {
  const prefix = options?.pathPrefix ?? "/agent";
  const linkingMode = options?.linkingMode ?? "component_api_only";
  if (linkingMode !== "component_api_only") {
    throw new Error(`Unsupported linkingMode: ${linkingMode}`);
  }
  const configuredServiceKeys = resolveConfiguredServiceKeys({
    serviceKeys: options?.serviceKeys,
    serviceKeysEnvVar: options?.serviceKeysEnvVar ?? "AGENT_BRIDGE_SERVICE_KEYS_JSON",
  });
  const auditHashSalt =
    readRuntimeEnv(options?.auditHashSaltEnvVar ?? "AGENT_BRIDGE_AUDIT_HASH_SALT") ??
    "";
  const normalizedConfig = normalizeAgentBridgeConfig(bridgeConfig);
  const availableFunctionKeys = Object.keys(normalizedConfig.functions);

  http.route({
    path: `${prefix}/execute`,
    method: "POST",
    handler: httpActionGeneric(async (ctx, request) => {
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

      const headerValidation = validateStrictServiceHeaders({
        request,
        configuredServiceKeys,
      });
      if (!headerValidation.valid) {
        return jsonResponse(
          { success: false, error: headerValidation.error },
          headerValidation.statusCode,
        );
      }

      const authResult = await ctx.runMutation(component.gateway.authorizeByAppKey, {
        appKey: headerValidation.appKey,
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
      const linkAuditContext = await extractLinkAuditContextFromRequest({
        request,
        auditHashSalt,
      });
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
          agentId: authResult.agentId as never,
          serviceId: headerValidation.serviceId,
          functionKey,
          args,
          result,
          duration: Date.now() - startTime,
          timestamp: Date.now(),
          ...linkAuditContext,
        });

        return jsonResponse({ success: true, result }, 200);
      } catch (error: unknown) {
        const errorMessage =
          error && typeof error === "object" && "message" in error
            ? (error.message as string)
            : "Unknown error";

        await ctx.runMutation(component.gateway.logAccess, {
          agentId: authResult.agentId as never,
          serviceId: headerValidation.serviceId,
          functionKey,
          args: body.args ?? {},
          error: errorMessage,
          errorCode: "bridge_execution_error",
          duration: Date.now() - startTime,
          timestamp: Date.now(),
          ...linkAuditContext,
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

function validateStrictServiceHeaders(args: {
  request: Request;
  configuredServiceKeys:
    | { ok: true; keysByServiceId: Record<string, string> }
    | { ok: false; error: string };
}):
  | { valid: true; serviceId: string; appKey: string }
  | { valid: false; error: string; statusCode: number } {
  const serviceId = args.request.headers.get("X-Agent-Service-Id")?.trim();
  const providedServiceKey = args.request.headers
    .get("X-Agent-Service-Key")
    ?.trim();
  const appKey = args.request.headers.get("X-Agent-App")?.trim();

  if (!serviceId) {
    return {
      valid: false,
      error: "Missing required header: X-Agent-Service-Id",
      statusCode: 400,
    };
  }
  if (!providedServiceKey) {
    return {
      valid: false,
      error: "Missing required header: X-Agent-Service-Key",
      statusCode: 400,
    };
  }
  if (!appKey) {
    return {
      valid: false,
      error: "Missing required header: X-Agent-App",
      statusCode: 400,
    };
  }

  if (!args.configuredServiceKeys.ok) {
    return {
      valid: false,
      error: args.configuredServiceKeys.error,
      statusCode: 500,
    };
  }

  const expectedServiceKey = args.configuredServiceKeys.keysByServiceId[serviceId];
  if (!expectedServiceKey) {
    return {
      valid: false,
      error: `Unknown service id: ${serviceId}`,
      statusCode: 401,
    };
  }
  if (providedServiceKey !== expectedServiceKey) {
    return {
      valid: false,
      error: "Invalid service key",
      statusCode: 401,
    };
  }

  return {
    valid: true,
    serviceId,
    appKey,
  };
}

function readRuntimeEnv(name: string): string | undefined {
  const maybeProcess = (globalThis as { process?: { env?: Record<string, string> } })
    .process;
  const value = maybeProcess?.env?.[name];
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

async function extractLinkAuditContextFromRequest(args: {
  request: Request;
  auditHashSalt: string;
}): Promise<{
  linkedProvider?: string;
  providerUserIdHash?: string;
  appUserSubjectHash?: string;
  linkStatus?: string;
}> {
  const linkedProvider =
    args.request.headers.get("X-Agent-Link-Provider")?.trim().toLowerCase() || undefined;
  const providerUserIdRaw =
    args.request.headers.get("X-Agent-Link-Provider-User-Id")?.trim() || undefined;
  const appUserSubjectRaw =
    args.request.headers.get("X-Agent-Link-User-Subject")?.trim() || undefined;
  const linkStatus = args.request.headers.get("X-Agent-Link-Status")?.trim() || undefined;
  const providerUserIdHash = providerUserIdRaw
    ? await hashAuditIdentifier(providerUserIdRaw, args.auditHashSalt)
    : undefined;
  const appUserSubjectHash = appUserSubjectRaw
    ? await hashAuditIdentifier(appUserSubjectRaw, args.auditHashSalt)
    : undefined;
  const auditContext: {
    linkedProvider?: string;
    providerUserIdHash?: string;
    appUserSubjectHash?: string;
    linkStatus?: string;
  } = {};
  if (linkedProvider) {
    auditContext.linkedProvider = linkedProvider;
  }
  if (providerUserIdHash) {
    auditContext.providerUserIdHash = providerUserIdHash;
  }
  if (appUserSubjectHash) {
    auditContext.appUserSubjectHash = appUserSubjectHash;
  }
  if (linkStatus) {
    auditContext.linkStatus = linkStatus;
  }
  return auditContext;
}

async function hashAuditIdentifier(value: string, salt: string): Promise<string> {
  const encoder = new TextEncoder();
  const input = encoder.encode(`${salt}:${value}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function resolveConfiguredServiceKeys(args: {
  serviceKeys?: Record<string, string>;
  serviceKeysEnvVar: string;
}):
  | { ok: true; keysByServiceId: Record<string, string> }
  | { ok: false; error: string } {
  if (args.serviceKeys) {
    return sanitizeServiceKeysMap(args.serviceKeys);
  }

  const json = readRuntimeEnv(args.serviceKeysEnvVar);
  if (!json) {
    return {
      ok: false,
      error: `Bridge service keys are not configured. Provide registerRoutes({ serviceKeys }) or set ${args.serviceKeysEnvVar}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {
      ok: false,
      error: `Invalid JSON in ${args.serviceKeysEnvVar}`,
    };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      error: `${args.serviceKeysEnvVar} must be a JSON object mapping serviceId to serviceKey`,
    };
  }

  return sanitizeServiceKeysMap(parsed as Record<string, unknown>);
}

function sanitizeServiceKeysMap(
  input: Record<string, unknown>,
): { ok: true; keysByServiceId: Record<string, string> } | { ok: false; error: string } {
  const keysByServiceId: Record<string, string> = {};
  for (const [serviceIdRaw, serviceKeyRaw] of Object.entries(input)) {
    if (typeof serviceKeyRaw !== "string") {
      return {
        ok: false,
        error: `Invalid service key value for "${serviceIdRaw}"`,
      };
    }
    const serviceId = serviceIdRaw.trim();
    const serviceKey = serviceKeyRaw.trim();
    if (!serviceId || !serviceKey) {
      return {
        ok: false,
        error: "Service ids and service keys cannot be empty",
      };
    }
    keysByServiceId[serviceId] = serviceKey;
  }

  if (Object.keys(keysByServiceId).length === 0) {
    return {
      ok: false,
      error: "At least one service key must be configured",
    };
  }

  return { ok: true, keysByServiceId };
}
