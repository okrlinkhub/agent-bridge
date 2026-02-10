export type TokenSource = "nextauth_convex" | "auth0" | "custom_oidc";

export type JwtAudience = string | Array<string>;

export interface JwtClaims {
  sub?: string;
  iss?: string;
  aud?: JwtAudience;
  exp?: number;
  [key: string]: unknown;
}

export interface JwtClaimValidationOptions {
  expectedIssuer?: string;
  expectedAudience?: string;
  nowMs?: number;
}

export interface JwtClaimValidationResult {
  valid: boolean;
  reason?: "malformed_token" | "expired" | "issuer_mismatch" | "audience_mismatch";
  claims: JwtClaims | null;
}

export interface AgentBridgeStrictHeadersInput {
  serviceId: string;
  serviceKey: string;
  appKey: string;
  userToken?: string | null;
}

export interface NextAuthSessionLike {
  convexToken?: string | null;
}

export type UserTokenResolver = () => Promise<string | null>;

export interface TokenSourceAdapter {
  tokenSource: TokenSource;
  resolveUserToken: UserTokenResolver;
}

export function buildAgentBridgeStrictHeaders(
  input: AgentBridgeStrictHeadersInput,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Agent-Service-Id": input.serviceId,
    "X-Agent-Service-Key": input.serviceKey,
    "X-Agent-App": input.appKey,
  };

  if (input.userToken) {
    headers.Authorization = `Bearer ${input.userToken}`;
  }

  return headers;
}

export function decodeJwtClaims(token: string): JwtClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) {
    return null;
  }

  try {
    const payload = decodeBase64Url(parts[1]);
    const claims = JSON.parse(payload) as JwtClaims;
    return claims;
  } catch {
    return null;
  }
}

export function validateJwtClaims(
  token: string,
  options?: JwtClaimValidationOptions,
): JwtClaimValidationResult {
  const claims = decodeJwtClaims(token);
  if (!claims) {
    return {
      valid: false,
      reason: "malformed_token",
      claims: null,
    };
  }

  const nowMs = options?.nowMs ?? Date.now();
  if (typeof claims.exp === "number") {
    const expiresAtMs = claims.exp * 1000;
    if (expiresAtMs <= nowMs) {
      return {
        valid: false,
        reason: "expired",
        claims,
      };
    }
  }

  if (options?.expectedIssuer && claims.iss !== options.expectedIssuer) {
    return {
      valid: false,
      reason: "issuer_mismatch",
      claims,
    };
  }

  if (options?.expectedAudience) {
    const audience = claims.aud;
    const hasAudienceMatch = Array.isArray(audience)
      ? audience.includes(options.expectedAudience)
      : audience === options.expectedAudience;

    if (!hasAudienceMatch) {
      return {
        valid: false,
        reason: "audience_mismatch",
        claims,
      };
    }
  }

  return {
    valid: true,
    claims,
  };
}

export function createNextAuthConvexTokenAdapter(args: {
  getSession: () => Promise<NextAuthSessionLike | null | undefined>;
}): TokenSourceAdapter {
  return {
    tokenSource: "nextauth_convex",
    resolveUserToken: async () => {
      const session = await args.getSession();
      const token = session?.convexToken;
      if (typeof token !== "string" || token.trim().length === 0) {
        return null;
      }
      return token;
    },
  };
}

export function createAuth0TokenAdapter(args: {
  getAccessToken: () => Promise<string | null | undefined>;
}): TokenSourceAdapter {
  return {
    tokenSource: "auth0",
    resolveUserToken: async () => {
      const token = await args.getAccessToken();
      if (typeof token !== "string" || token.trim().length === 0) {
        return null;
      }
      return token;
    },
  };
}

export function createCustomOidcTokenAdapter(args: {
  getToken: () => Promise<string | null | undefined>;
}): TokenSourceAdapter {
  return {
    tokenSource: "custom_oidc",
    resolveUserToken: async () => {
      const token = await args.getToken();
      if (typeof token !== "string" || token.trim().length === 0) {
        return null;
      }
      return token;
    },
  };
}

export async function resolveUserToken(
  adapter: TokenSourceAdapter,
): Promise<string | null> {
  return await adapter.resolveUserToken();
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const paddingLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(paddingLength);

  if (typeof atob === "function") {
    return atob(padded);
  }

  const buffer = Buffer.from(padded, "base64");
  return buffer.toString("utf-8");
}
