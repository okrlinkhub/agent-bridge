import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Example app tables -- these are the functions that agents can call.
  items: defineTable({
    name: v.string(),
    description: v.string(),
    status: v.union(v.literal("active"), v.literal("archived")),
    createdBy: v.string(),
  }).index("by_status", ["status"]),
});
