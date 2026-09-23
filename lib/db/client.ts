import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

// One client per process — Next dev hot-reloads modules, so park it on globalThis.
const globalForDb = globalThis as unknown as { __legworkDb?: Client };

function getClient(): Client {
  if (!globalForDb.__legworkDb) {
    globalForDb.__legworkDb = createClient({
      url: process.env.DATABASE_URL ?? "file:./legwork.db",
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return globalForDb.__legworkDb;
}

export const db = drizzle(getClient(), { schema });
