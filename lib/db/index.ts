import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. See .env.example.");
}

// Neon's HTTP driver: one fetch per query, ideal for serverless / edge.
// Switch to `drizzle-orm/neon-serverless` (WebSockets) if we need interactive
// multi-statement transactions later.
const sql = neon(process.env.DATABASE_URL);

export const db = drizzle({
  client: sql,
  schema,
  casing: "snake_case",
});

export type Database = typeof db;

export * from "./schema";
