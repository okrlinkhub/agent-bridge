import { describe, expect, test } from "vitest";
import {
  buildAgentBridgeStrictHeaders,
  createAuth0TokenAdapter,
  createCustomOidcTokenAdapter,
  createNextAuthConvexTokenAdapter,
  decodeJwtClaims,
  resolveUserToken,
  validateJwtClaims,
} from "./userAuth.js";

const TEST_JWT =
  "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ1c2VyXzEyMyIsImlzcyI6Imh0dHBzOi8vZGVtby5jb252ZXguc2l0ZSIsImF1ZCI6ImNvbnZleCIsImV4cCI6NDA3MDkwODgwMH0.";

describe("user auth helpers", () => {
  test("builds strict headers and includes bearer when provided", () => {
    const headers = buildAgentBridgeStrictHeaders({
      serviceId: "openclaw-prod",
      serviceKey: "abs_live_example",
      appKey: "crm",
      userToken: "jwt_token",
    });

    expect(headers["X-Agent-Service-Id"]).toBe("openclaw-prod");
    expect(headers["X-Agent-Service-Key"]).toBe("abs_live_example");
    expect(headers["X-Agent-App"]).toBe("crm");
    expect(headers.Authorization).toBe("Bearer jwt_token");
  });

  test("decodes jwt claims", () => {
    const claims = decodeJwtClaims(TEST_JWT);
    expect(claims?.sub).toBe("user_123");
    expect(claims?.iss).toBe("https://demo.convex.site");
    expect(claims?.aud).toBe("convex");
  });

  test("validates jwt claims with issuer and audience", () => {
    const validation = validateJwtClaims(TEST_JWT, {
      expectedIssuer: "https://demo.convex.site",
      expectedAudience: "convex",
      nowMs: Date.UTC(2026, 0, 1),
    });
    expect(validation.valid).toBe(true);
  });

  test("fails when jwt is expired", () => {
    const expired = validateJwtClaims(TEST_JWT, {
      nowMs: Date.UTC(2100, 0, 1),
    });
    expect(expired.valid).toBe(false);
    expect(expired.reason).toBe("expired");
  });

  test("resolves nextauth convex token", async () => {
    const adapter = createNextAuthConvexTokenAdapter({
      getSession: async () => ({ convexToken: "convex_jwt" }),
    });
    const token = await resolveUserToken(adapter);
    expect(token).toBe("convex_jwt");
  });

  test("resolves auth0 token", async () => {
    const adapter = createAuth0TokenAdapter({
      getAccessToken: async () => "auth0_jwt",
    });
    const token = await resolveUserToken(adapter);
    expect(token).toBe("auth0_jwt");
  });

  test("resolves custom oidc token", async () => {
    const adapter = createCustomOidcTokenAdapter({
      getToken: async () => "oidc_jwt",
    });
    const token = await resolveUserToken(adapter);
    expect(token).toBe("oidc_jwt");
  });
});
