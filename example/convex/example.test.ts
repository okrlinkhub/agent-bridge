import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { initConvexTest } from "./setup.test";
import { api } from "./_generated/api";

describe("example app", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
  });

  test("setup registers functions", async () => {
    const t = initConvexTest();
    await t.mutation(api.example.setup, {});

    const functions = await t.query(api.example.registeredFunctions, {});
    expect(functions.length).toBeGreaterThan(0);
    expect(functions.map((f) => f.functionName)).toContain("demo:listItems");
  });

  test("createItem and listItems", async () => {
    const t = initConvexTest();

    const itemId = await t.mutation(api.example.createItem, {
      name: "Test Item",
      description: "A test item",
    });
    expect(itemId).toBeDefined();

    const items = await t.query(api.example.listItems, {});
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("Test Item");
  });
});
