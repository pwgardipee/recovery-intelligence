import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema";

// Neon's HTTP driver: one fetch per query, ideal for serverless / edge.
// We don't throw at import time so pages that catch DB errors can still
// render a setup state when the URL is missing. The eventual query throws
// with a clear message.
const url = process.env.DATABASE_URL ?? "postgres://invalid";
const sql = neon(url);

export const db = drizzle({
  client: sql,
  schema,
  casing: "snake_case",
});

export type Database = typeof db;

export * from "./schema";
