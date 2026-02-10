import type { Doc } from "./_generated/dataModel.js";

export type PermissionType = "allow" | "deny" | "rate_limited";

export async function hashApiKey(apiKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(apiKey);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function matchesPattern(functionKey: string, pattern: string): boolean {
  if (pattern === "*") {
    return true;
  }

  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const regexPattern = "^" + escaped.replace(/\*/g, ".*") + "$";
  return new RegExp(regexPattern).test(functionKey);
}

export function patternSpecificity(pattern: string): number {
  const wildcardIndex = pattern.indexOf("*");
  if (wildcardIndex === -1) {
    return pattern.length;
  }
  return wildcardIndex;
}

export function findBestPermissionMatch(
  functionKey: string,
  permissions: Array<Doc<"agentPermissions">>,
): Doc<"agentPermissions"> | null {
  const matches = permissions
    .filter((permission) => matchesPattern(functionKey, permission.functionPattern))
    .sort(
      (a, b) =>
        patternSpecificity(b.functionPattern) - patternSpecificity(a.functionPattern),
    );
  return matches[0] ?? null;
}

export function patternMatchesAvailableFunctions(
  pattern: string,
  availableFunctionKeys: string[],
): boolean {
  return availableFunctionKeys.some((functionKey) =>
    matchesPattern(functionKey, pattern),
  );
}
